import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { canonicalize } from '../src/ledger/canonicalJson';
import { computeEventHashV1, GENESIS_HASH } from '../src/ledger/hashChain';
import { asAttacker, createActor, createTenant, sampleBatch, TestDb, TEST_LEGACY_KEY, useTestDatabase } from './helpers/testDb';

const getDb = useTestDatabase();

async function batchWithTwoEvents(t: TestDb) {
  const tenant = await createTenant(t);
  const farmer = await createActor(t, tenant, 'FARMER');
  const processor = await createActor(t, tenant, 'PROCESSOR');
  const admin = await createActor(t, tenant, 'ADMIN');
  const svc = t.ctx.supplyChainService;
  const batch = await svc.createBatch(farmer, sampleBatch);
  await svc.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'x', assignNextTo: processor.id });
  await svc.recordEvent(processor, { batchId: batch.id, stage: 'PROCESSING', location: 'y', assignNextTo: admin.id });
  return { tenant, farmer, processor, admin, batch };
}

describe('TraceService', () => {
  it('traces forward and backward, and the untouched chain is valid', async () => {
    const t = getDb();
    const { farmer, batch } = await batchWithTwoEvents(t);
    const forward = await t.ctx.traceService.trace(batch.id, 'forward', farmer);
    expect(forward.events.map((e) => e.stage)).toEqual(['HARVEST', 'PROCESSING']);
    expect(forward.isValid).toBe(true);
    expect(forward.anomalies).toHaveLength(0);

    const backward = await t.ctx.traceService.trace(batch.id, 'backward', farmer);
    expect(backward.events.map((e) => e.stage)).toEqual(['PROCESSING', 'HARVEST']);
  });

  it('flags the chain invalid once a stored event is edited behind the application\'s back', async () => {
    const t = getDb();
    const { farmer, batch } = await batchWithTwoEvents(t);
    await asAttacker(t, "UPDATE trace_events SET location = 'TAMPERED' WHERE batch_id = $1 AND sequence_number = 0", [batch.id]);

    expect((await t.ctx.traceService.trace(batch.id, 'forward', farmer)).isValid).toBe(false);
    const full = await t.ctx.traceService.verifyPublic(batch.id);
    expect(full).toMatchObject({ valid: false, brokenAtIndex: 0, problem: 'TAMPERED_EVENT' });
  });

  it('flags a deleted tail — the remaining chain links perfectly but no longer reaches the recorded head', async () => {
    const t = getDb();
    const { batch } = await batchWithTwoEvents(t);
    await asAttacker(t, 'DELETE FROM trace_events WHERE batch_id = $1 AND sequence_number = 1', [batch.id]);

    const full = await t.ctx.traceService.verifyPublic(batch.id);
    expect(full.events).toHaveLength(1);
    expect(full.perEvent[0]).toMatchObject({ matchesStoredHash: true, linksToPrevious: true });
    expect(full).toMatchObject({ valid: false, problem: 'HEAD_MISMATCH', headMatches: false });
  });

  it('surfaces anomalies detected across the batch history', async () => {
    const t = getDb();
    const tenant = await createTenant(t);
    const admin = await createActor(t, tenant, 'ADMIN');
    const batch = await t.ctx.supplyChainService.createBatch(admin, sampleBatch);
    await t.ctx.supplyChainService.recordEvent(admin, { batchId: batch.id, stage: 'HARVEST', location: 'x' });
    await t.ctx.supplyChainService.recordEvent(admin, { batchId: batch.id, stage: 'PACKAGING', location: 'x' });
    const result = await t.ctx.traceService.trace(batch.id, 'forward', admin);
    expect(result.anomalies.some((a) => a.type === 'STAGE_SKIPPED')).toBe(true);
  });

  it("is tenant-scoped for authenticated traces (another tenant gets 404)", async () => {
    const t = getDb();
    const { batch } = await batchWithTwoEvents(t);
    const outsider = await createActor(t, await createTenant(t), 'ADMIN');
    await expect(t.ctx.traceService.trace(batch.id, 'forward', outsider)).rejects.toThrow('Batch not found');
  });

  it('builds a public trace without exposing internal batch fields', async () => {
    const t = getDb();
    const { batch } = await batchWithTwoEvents(t);
    const publicTrace = await t.ctx.traceService.publicTrace(batch.id);
    expect(publicTrace).toMatchObject({ stageCount: 2, isValid: true, hasAnomalies: false });
    expect((publicTrace.batch as Record<string, unknown>).createdBy).toBeUndefined();
  });

  it('publishes the journey by organization with only whitelisted event facts', async () => {
    const t = getDb();
    const tenant = await createTenant(t);
    const farmer = await createActor(t, tenant, 'FARMER', { name: 'Nguyễn Văn A', organization: 'HTX Cầu Đất' });
    const processor = await createActor(t, tenant, 'PROCESSOR');
    const batch = await t.ctx.supplyChainService.createBatch(farmer, sampleBatch);
    await t.ctx.supplyChainService.recordEvent(farmer, {
      batchId: batch.id,
      stage: 'HARVEST',
      location: 'Cầu Đất, Lâm Đồng',
      data: { variety: 'Arabica', harvestDate: '2026-09-30', internalPlotNo: 'L-17' },
      assignNextTo: processor.id,
    });

    const { journey } = await t.ctx.traceService.publicTrace(batch.id);
    expect(journey).toHaveLength(1);
    expect(journey[0]).toMatchObject({
      stage: 'HARVEST',
      location: 'Cầu Đất, Lâm Đồng',
      organization: 'HTX Cầu Đất',
      details: { variety: 'Arabica', harvestDate: '2026-09-30' },
    });
    // Neither the person nor non-whitelisted internal fields leave the tenant.
    expect(journey[0].details).not.toHaveProperty('internalPlotNo');
    expect(JSON.stringify(journey)).not.toContain('Nguyễn Văn A');
  });

  it('returns 404 for unknown or malformed ids on public routes', async () => {
    const t = getDb();
    await expect(t.ctx.traceService.publicTrace(uuidv4())).rejects.toThrow('Batch not found');
    await expect(t.ctx.traceService.publicTrace('not-a-uuid')).rejects.toThrow('Batch not found');
    await expect(t.ctx.traceService.verifyPublic("'; DROP TABLE batches; --")).rejects.toThrow('Batch not found');
  });

  it('publishes everything a third party needs to recompute every v2 hash with NO server secret', async () => {
    const t = getDb();
    const { batch } = await batchWithTwoEvents(t);
    const { events, valid } = await t.ctx.traceService.verifyPublic(batch.id);
    expect(valid).toBe(true);

    // An independent verifier: only JCS + SHA-256, nothing imported from the ledger module's hashing.
    let prev = GENESIS_HASH;
    for (const e of events) {
      const preimage = canonicalize({
        v: 2,
        salt: e.salt,
        batchId: e.batchId,
        sequenceNumber: e.sequenceNumber,
        prevHash: e.prevHash,
        stage: e.stage,
        actorId: e.actorId,
        timestamp: new Date(e.timestamp).toISOString(),
        location: e.location,
        notes: e.notes ?? null,
        data: e.data,
      });
      expect(createHash('sha256').update(preimage, 'utf8').digest('hex')).toBe(e.hash);
      expect(e.prevHash).toBe(prev);
      prev = e.hash;
    }
    expect(events.every((e) => !('tenantId' in e))).toBe(true);
  });

  it('still verifies legacy v1 (HMAC) events written before hash v2, given the legacy key', async () => {
    const t = getDb();
    const tenant = await createTenant(t);
    const farmer = await createActor(t, tenant, 'FARMER');
    const batch = await t.ctx.supplyChainService.createBatch(farmer, sampleBatch);

    // Simulate a pre-v2 row exactly as the old code wrote it.
    const legacy = {
      batchId: batch.id,
      stage: 'HARVEST' as const,
      actorId: farmer.id,
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
      location: 'legacy',
      notes: undefined,
      data: {},
      prevHash: GENESIS_HASH,
      sequenceNumber: 0,
    };
    const legacyHash = computeEventHashV1(legacy, TEST_LEGACY_KEY);
    await t.ownerPool.query(
      `INSERT INTO trace_events (id, batch_id, tenant_id, stage, actor_id, timestamp, location, data, hash, prev_hash,
                                 sequence_number, hash_version)
       VALUES ($1, $2, $3, 'HARVEST', $4, $5, 'legacy', '{}', $6, $7, 0, 1)`,
      [uuidv4(), batch.id, tenant.id, farmer.id, legacy.timestamp, legacyHash, GENESIS_HASH],
    );
    // ...and v2 continues the same chain.
    const admin = await createActor(t, tenant, 'ADMIN');
    await t.ctx.supplyChainService.recordEvent(admin, { batchId: batch.id, stage: 'PROCESSING', location: 'v2' });

    const result = await t.ctx.traceService.verifyPublic(batch.id);
    expect(result).toMatchObject({ valid: true, legacyEventCount: 1 });
    expect(result.perEvent.map((p) => p.hashVersion)).toEqual([1, 2]);
  });
});
