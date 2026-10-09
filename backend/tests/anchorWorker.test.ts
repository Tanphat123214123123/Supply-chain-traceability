import { AnchorWorker } from '../src/anchor/anchorWorker';
import { verifyInclusion } from '../src/ledger/merkle';
import { FakeChain } from './helpers/fakeChain';
import { createActor, createTenant, sampleBatch, TestDb, useTestDatabase } from './helpers/testDb';

const getDb = useTestDatabase();

async function seedEvents(t: TestDb, perTenant: number[]) {
  const ids: string[] = [];
  for (const n of perTenant) {
    const tenant = await createTenant(t);
    const admin = await createActor(t, tenant, 'ADMIN');
    for (let i = 0; i < n; i++) {
      const batch = await t.ctx.supplyChainService.createBatch(admin, sampleBatch);
      const e = await t.ctx.supplyChainService.recordEvent(admin, { batchId: batch.id, stage: 'HARVEST', location: `x${i}` });
      ids.push(e.id);
    }
  }
  return ids;
}

function worker(t: TestDb, chain: FakeChain, overrides: Partial<ConstructorParameters<typeof AnchorWorker>[2]> = {}) {
  return new AnchorWorker(t.ctx.anchorStore, chain, {
    maxLeaves: 1000,
    confirmations: 1,
    receiptTimeoutMs: 10,
    resubmitAfterMs: 60_000,
    ...overrides,
  });
}

/** Count of anchor_leaves rows across all tenants (owner connection bypasses RLS). */
async function leafCount(t: TestDb): Promise<number> {
  const r = await t.ownerPool.query('SELECT count(*)::int AS n FROM anchor_leaves');
  return r.rows[0].n;
}

describe('AnchorWorker', () => {
  it('anchors every tenant\'s events in one batch, with proofs that verify against the on-chain root', async () => {
    const t = getDb();
    const chain = new FakeChain();
    const eventIds = await seedEvents(t, [3, 2]);
    const w = worker(t, chain);

    expect(await w.tick()).toMatchObject({ action: 'submitted' });
    expect(await w.tick()).toMatchObject({ action: 'confirmed' });
    expect(await w.tick()).toEqual({ action: 'idle' });

    const [anchor] = await t.ctx.anchorStore.findRecent(5);
    expect(anchor).toMatchObject({ status: 'confirmed', leafCount: 5, chainId: 31337 });
    expect(chain.anchoredRoots()).toEqual([anchor.root]);

    const rows = await t.ownerPool.query(
      `SELECT l.event_id, l.leaf_index, l.proof, e.hash FROM anchor_leaves l JOIN trace_events e ON e.id = l.event_id`,
    );
    expect(rows.rows.map((r) => r.event_id).sort()).toEqual([...eventIds].sort());
    for (const r of rows.rows) {
      expect(verifyInclusion(r.hash, r.leaf_index, anchor.leafCount, r.proof, anchor.root)).toBe(true);
    }
  });

  it('only picks up new events in the next batch — never re-anchors an event', async () => {
    const t = getDb();
    const chain = new FakeChain();
    await seedEvents(t, [2]);
    const w = worker(t, chain);
    await w.tick();
    await w.tick();
    await seedEvents(t, [1]);
    await w.tick();
    await w.tick();
    const anchors = await t.ctx.anchorStore.findRecent(5);
    expect(anchors.map((a) => a.leafCount)).toEqual([1, 2]);
    expect(await leafCount(t)).toBe(3);
  });

  it('respects maxLeaves and continues with the rest', async () => {
    const t = getDb();
    const chain = new FakeChain();
    await seedEvents(t, [5]);
    const w = worker(t, chain, { maxLeaves: 2 });
    for (let i = 0; i < 6; i++) await w.tick();
    expect((await t.ctx.anchorStore.findRecent(10)).map((a) => a.leafCount).sort()).toEqual([1, 2, 2]);
    expect(await leafCount(t)).toBe(5);
  });

  it('survives an RPC failure on submit: retries the SAME batch, no duplicate', async () => {
    const t = getDb();
    const chain = new FakeChain();
    await seedEvents(t, [2]);
    const w = worker(t, chain);
    chain.failNextSubmit = true;
    expect(await w.tick()).toMatchObject({ action: 'error' });
    const [built] = await t.ctx.anchorStore.findRecent(1);
    expect(built).toMatchObject({ status: 'built', attempts: 1, lastError: 'RPC unavailable' });

    await w.tick();
    await w.tick();
    const anchors = await t.ctx.anchorStore.findRecent(5);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toMatchObject({ id: built.id, status: 'confirmed' });
  });

  it('a lost receipt is recovered from the chain itself on the next tick', async () => {
    const t = getDb();
    const chain = new FakeChain();
    await seedEvents(t, [1]);
    const w = worker(t, chain);
    chain.loseNextReceipt = true;
    await w.tick(); // submitted (and actually mined)
    expect(await w.tick()).toMatchObject({ action: 'confirmed' }); // getAnchor(root) finds it
    expect(chain.submitCalls).toBe(1);
  });

  it('a dropped transaction is resent after the resubmit window, without ever anchoring twice', async () => {
    const t = getDb();
    const chain = new FakeChain();
    await seedEvents(t, [1]);
    const w = worker(t, chain, { resubmitAfterMs: 0 });
    chain.dropNextTx = true;
    await w.tick(); // submitted, never mined
    expect(await w.tick()).toMatchObject({ action: 'waiting' }); // gives up on it → back to built
    expect((await t.ctx.anchorStore.findRecent(1))[0].status).toBe('built');
    await w.tick(); // resubmitted, mined
    expect(await w.tick()).toMatchObject({ action: 'confirmed' });
    expect(chain.anchoredRoots()).toHaveLength(1);
  });

  it('a crash after building (before any send) resumes from the stored batch', async () => {
    const t = getDb();
    const chain = new FakeChain();
    await seedEvents(t, [3]);
    const built = await t.ctx.anchorStore.buildBatch({ maxLeaves: 100, chainId: chain.chainId, contractAddress: chain.contractAddress });
    expect(built).not.toBeNull();
    // A fresh worker (new process) finds it in flight and carries on.
    const w = worker(t, chain);
    await w.tick();
    expect(await w.tick()).toMatchObject({ action: 'confirmed', anchor: { id: built!.id } });
    // No second batch was built while the first was in flight.
    expect(await t.ctx.anchorStore.buildBatch({ maxLeaves: 100, chainId: 1, contractAddress: chain.contractAddress })).toBeNull();
  });

  it('exposes proofs to the public verifier once anchored', async () => {
    const t = getDb();
    const chain = new FakeChain();
    const tenant = await createTenant(t);
    const admin = await createActor(t, tenant, 'ADMIN');
    const batch = await t.ctx.supplyChainService.createBatch(admin, sampleBatch);
    await t.ctx.supplyChainService.recordEvent(admin, { batchId: batch.id, stage: 'HARVEST', location: 'x' });

    expect((await t.ctx.traceService.verifyPublic(batch.id)).events[0].anchor).toBeUndefined();
    const w = worker(t, chain);
    await w.tick();
    await w.tick();
    const [e] = (await t.ctx.traceService.verifyPublic(batch.id)).events;
    expect(e.anchor).toMatchObject({ leafIndex: 0, anchor: { status: 'confirmed', chainId: 31337 } });
    expect(verifyInclusion(e.hash, e.anchor!.leafIndex, e.anchor!.anchor.leafCount, e.anchor!.proof, e.anchor!.anchor.root)).toBe(true);
  });
});
