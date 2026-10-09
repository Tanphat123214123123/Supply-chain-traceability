import { AnchorWorker } from '../src/anchor/anchorWorker';
import { TraceEvent } from '../src/domain/types';
import { computeEventHashV3, hashOfDisclosure } from '../src/ledger/hashChain';
import { buildMerkleTree, verifyInclusion } from '../src/ledger/merkle';
import { FakeChain } from './helpers/fakeChain';
import { asAttacker, createActor, createTenant, TestDb, useTestDatabase } from './helpers/testDb';

/**
 * WP7 — the fraud scenarios from docs/PHASE1.md, each checked the way an
 * outside verifier would: from the public verification payload plus the
 * chain itself. The strongest attacker here owns the database outright.
 */
const getDb = useTestDatabase();

async function anchoredBatch(t: TestDb) {
  const chain = new FakeChain();
  const tenant = await createTenant(t);
  const farmer = await createActor(t, tenant, 'FARMER');
  const inspector = await createActor(t, tenant, 'INSPECTOR');
  const processor = await createActor(t, tenant, 'PROCESSOR');
  const batch = await t.ctx.supplyChainService.createBatch(farmer, {
    productName: 'Cà phê nhân xanh',
    productType: 'Cà phê quả tươi',
    origin: 'Cầu Đất',
    quantity: 1000,
    unit: 'kg',
  });
  await t.ctx.supplyChainService.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'Cầu Đất', assignNextTo: processor.id });
  await t.ctx.supplyChainService.recordEvent(processor, { batchId: batch.id, stage: 'PROCESSING', location: 'Xưởng', assignNextTo: inspector.id });
  await t.ctx.supplyChainService.recordEvent(inspector, {
    batchId: batch.id,
    stage: 'QUALITY_CHECK',
    location: 'Lab',
    data: { result: 'FAIL' },
    assignNextTo: processor.id,
  });
  const w = new AnchorWorker(t.ctx.anchorStore, chain, { maxLeaves: 100, confirmations: 1, receiptTimeoutMs: 10, resubmitAfterMs: 60_000 });
  await w.tick();
  await w.tick();
  return { chain, batch, inspector };
}

/** What the browser verifier concludes for one event: content recomputes AND its proof leads to a root the chain has. */
async function outsideVerdict(t: TestDb, batchId: string, chain: FakeChain) {
  const payload = await t.ctx.traceService.verifyPublic(batchId);
  const perEvent = [];
  for (const e of payload.events) {
    const content = e.disclosure ? hashOfDisclosure(e.disclosure) === e.hash : null;
    const proofOk = e.anchor ? verifyInclusion(e.hash, e.anchor.leafIndex, e.anchor.anchor.leafCount, e.anchor.proof, e.anchor.anchor.root) : false;
    const onChain = e.anchor ? (await chain.getAnchor(e.anchor.anchor.root)) !== null : false;
    perEvent.push({ content, anchored: proofOk && onChain });
  }
  return { serverCheck: payload.serverCheck, perEvent };
}

describe('Fraud scenarios (WP7)', () => {
  it('baseline: an honest, anchored batch verifies fully from the outside', async () => {
    const t = getDb();
    const { chain, batch } = await anchoredBatch(t);
    const v = await outsideVerdict(t, batch.id, chain);
    expect(v.serverCheck.valid).toBe(true);
    expect(v.perEvent).toEqual([
      { content: true, anchored: true },
      { content: true, anchored: true },
      { content: true, anchored: true },
    ]);
  });

  it('editing a value in the database is caught even by the public verifier', async () => {
    const t = getDb();
    const { chain, batch } = await anchoredBatch(t);
    await asAttacker(t, `UPDATE trace_events SET data = '{"result":"PASS"}' WHERE batch_id = $1 AND stage = 'QUALITY_CHECK'`, [batch.id]);
    const v = await outsideVerdict(t, batch.id, chain);
    expect(v.serverCheck).toMatchObject({ valid: false, problem: 'DISCLOSURE_MISMATCH', brokenAtIndex: 2 });
    expect(v.perEvent[2].content).toBe(false);
  });

  it('a DB owner who rewrites a result AND recomputes every hash, link and head still fails — only against the blockchain', async () => {
    const t = getDb();
    const { chain, batch } = await anchoredBatch(t);

    // The attacker has everything the server has: rows, salts, the hash spec.
    const rows = await t.ownerPool.query(
      `SELECT id, batch_id, tenant_id, stage, actor_id, timestamp, location, notes, data, prev_hash, sequence_number, kind, links, claim_salts
         FROM trace_events WHERE batch_id = $1 ORDER BY sequence_number`,
      [batch.id],
    );
    let prev = '0'.repeat(64);
    for (const r of rows.rows) {
      const data = r.stage === 'QUALITY_CHECK' ? { result: 'PASS' } : r.data; // the lie: failed QC becomes a pass
      const e = { batchId: r.batch_id, stage: r.stage, actorId: r.actor_id, timestamp: r.timestamp, location: r.location, notes: r.notes ?? undefined, data, prevHash: prev, sequenceNumber: r.sequence_number, kind: r.kind, links: r.links } as TraceEvent;
      const hash = computeEventHashV3(e, r.claim_salts);
      await asAttacker(t, 'UPDATE trace_events SET data = $2, prev_hash = $3, hash = $4 WHERE id = $1', [r.id, JSON.stringify(data), prev, hash]);
      prev = hash;
    }
    await asAttacker(t, 'UPDATE batches SET head_hash = $2 WHERE id = $1', [batch.id, prev]);
    // ...and even rebuilds the Merkle tree and rewrites the stored proofs and root.
    const leaves = await t.ownerPool.query(
      `SELECT l.event_id, l.leaf_index, a.id AS anchor_id FROM anchor_leaves l JOIN anchors a ON a.id = l.anchor_id ORDER BY l.leaf_index`,
    );
    const hashes = await t.ownerPool.query('SELECT id, hash FROM trace_events WHERE id = ANY ($1::uuid[])', [leaves.rows.map((l) => l.event_id)]);
    const byId = new Map(hashes.rows.map((h) => [h.id, h.hash]));
    const tree = buildMerkleTree(leaves.rows.map((l) => byId.get(l.event_id)));
    for (const l of leaves.rows) {
      await asAttacker(t, 'UPDATE anchor_leaves SET proof = $2 WHERE event_id = $1', [l.event_id, tree.proofs[l.leaf_index]]);
    }
    await asAttacker(t, 'UPDATE anchors SET root = $2 WHERE id = $1', [leaves.rows[0].anchor_id, tree.root]);

    const v = await outsideVerdict(t, batch.id, chain);
    // Everything the server holds is self-consistent again...
    expect(v.serverCheck.valid).toBe(true);
    expect(v.perEvent.every((e) => e.content === true)).toBe(true);
    // ...but the root it now presents was never anchored: the chain exposes the rewrite.
    expect(v.perEvent.map((e) => e.anchored)).toEqual([false, false, false]);
    expect(await chain.getAnchor(tree.root)).toBeNull();
  });

  it('deleting the tail (hiding the failed QC) is caught by the recorded head', async () => {
    const t = getDb();
    const { chain, batch } = await anchoredBatch(t);
    await asAttacker(t, `DELETE FROM anchor_leaves WHERE event_id IN (SELECT id FROM trace_events WHERE batch_id = $1 AND sequence_number = 2)`, [batch.id]);
    await asAttacker(t, 'DELETE FROM trace_events WHERE batch_id = $1 AND sequence_number = 2', [batch.id]);
    const v = await outsideVerdict(t, batch.id, chain);
    expect(v.serverCheck).toMatchObject({ valid: false, problem: 'HEAD_MISMATCH' });
  });

  it('inflated production is flagged: a transform yielding more green beans than cherries allow', async () => {
    const t = getDb();
    const tenant = await createTenant(t);
    const farmer = await createActor(t, tenant, 'FARMER');
    const processor = await createActor(t, tenant, 'PROCESSOR');
    const lot = await t.ctx.supplyChainService.createBatch(farmer, {
      productName: 'Quả tươi',
      productType: 'Cà phê quả tươi',
      origin: 'x',
      quantity: 1,
      unit: 'tấn',
    });
    await t.ctx.supplyChainService.recordEvent(farmer, { batchId: lot.id, stage: 'HARVEST', location: 'x', assignNextTo: processor.id });
    const r = await t.ctx.lineageService.createTransformation(processor, {
      kind: 'TRANSFORM',
      stage: 'PROCESSING',
      location: 'x',
      inputs: [{ lotId: lot.id, quantity: 1 }],
      outputs: [{ productName: 'Nhân xanh', productType: 'Cà phê nhân xanh', quantity: 600, unit: 'kg' }],
    });
    expect(r.anomalies[0]).toMatchObject({ type: 'MASS_BALANCE_VIOLATION' });
    expect((await t.ctx.traceService.publicTrace(r.outputs[0].id)).hasAnomalies).toBe(true);
  });
});
