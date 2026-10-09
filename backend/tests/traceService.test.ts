import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { canonicalize } from '../src/ledger/canonicalJson';
import jwt from 'jsonwebtoken';
import { computeEventHashV1, GENESIS_HASH, hashOfDisclosure } from '../src/ledger/hashChain';
import { asAttacker, createActor, createTenant, sampleBatch, TestDb, TEST_JWT_SECRET, TEST_LEGACY_KEY, useTestDatabase } from './helpers/testDb';

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
    // Public access: the opened "location" claim no longer reproduces the stored hash.
    const pub = await t.ctx.traceService.verifyPublic(batch.id);
    expect(pub.serverCheck).toMatchObject({ valid: false, brokenAtIndex: 0, problem: 'DISCLOSURE_MISMATCH' });
    // Full access recomputes every field.
    const { token } = await t.ctx.traceService.createVerificationLink(farmer, batch.id, 1);
    const full = await t.ctx.traceService.verifyPublic(batch.id, token);
    expect(full.serverCheck).toMatchObject({ valid: false, brokenAtIndex: 0, problem: 'TAMPERED_EVENT' });
  });

  it('flags a deleted tail — the remaining chain links perfectly but no longer reaches the recorded head', async () => {
    const t = getDb();
    const { batch } = await batchWithTwoEvents(t);
    await asAttacker(t, 'DELETE FROM trace_events WHERE batch_id = $1 AND sequence_number = 1', [batch.id]);

    const pub = await t.ctx.traceService.verifyPublic(batch.id);
    expect(pub.events).toHaveLength(1);
    expect(hashOfDisclosure(pub.events[0].disclosure!)).toBe(pub.events[0].hash);
    expect(pub.serverCheck).toMatchObject({ valid: false, problem: 'HEAD_MISMATCH', headMatches: false });
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

  it('public verification opens only whitelisted fields, yet a third party can recompute every hash', async () => {
    const t = getDb();
    const tenant = await createTenant(t);
    const farmer = await createActor(t, tenant, 'FARMER');
    const processor = await createActor(t, tenant, 'PROCESSOR');
    const batch = await t.ctx.supplyChainService.createBatch(farmer, sampleBatch);
    await t.ctx.supplyChainService.recordEvent(farmer, {
      batchId: batch.id,
      stage: 'HARVEST',
      location: 'Cầu Đất',
      notes: 'nội bộ: giá thu mua 52.000đ/kg',
      data: { variety: 'Robusta', moisture: 13.5, internalPlotNo: 'L-17' },
      assignNextTo: processor.id,
    });

    const payload = await t.ctx.traceService.verifyPublic(batch.id);
    expect(payload.access).toBe('public');
    expect(payload.serverCheck.valid).toBe(true);
    const json = JSON.stringify(payload);
    for (const secret of ['giá thu mua', 'L-17', '13.5', farmer.id, tenant.id]) expect(json).not.toContain(secret);

    const [e] = payload.events;
    expect(e.disclosure!.disclosed.map((c) => c.name).sort()).toEqual(['data.variety', 'location']);
    expect(e.disclosure!.hidden).toHaveLength(4); // actorId, notes, data.moisture, data.internalPlotNo

    // An independent verifier: only JCS + SHA-256, nothing imported from the ledger module's hashing.
    const sha = (x: string) => createHash('sha256').update(x, 'utf8').digest('hex');
    const opened = e.disclosure!.disclosed.map((c) => sha(canonicalize({ name: c.name, salt: c.salt, value: c.value })));
    const claims = [...opened, ...e.disclosure!.hidden].sort();
    expect(sha(canonicalize({ ...e.disclosure!.envelope, claims }))).toBe(e.hash);
    expect(e.disclosure!.envelope).toMatchObject({ v: 3, batchId: batch.id, prevHash: GENESIS_HASH, kind: 'OBSERVE', links: [] });
  });

  it('a verification link opens every field, only for its own batch, and expires', async () => {
    const t = getDb();
    const { farmer, batch } = await batchWithTwoEvents(t);
    const other = await t.ctx.supplyChainService.createBatch(farmer, sampleBatch);
    const { token, expiresAt } = await t.ctx.traceService.createVerificationLink(farmer, batch.id, 7);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);

    const full = await t.ctx.traceService.verifyPublic(batch.id, token);
    expect(full.access).toBe('full');
    expect(full.serverCheck.valid).toBe(true);
    expect(full.events[0].disclosure!.hidden).toHaveLength(0);
    expect(full.events[0].disclosure!.disclosed.map((c) => c.name)).toContain('actorId');

    await expect(t.ctx.traceService.verifyPublic(other.id, token)).rejects.toThrow(/invalid or has expired/);
    await expect(t.ctx.traceService.verifyPublic(batch.id, 'garbage')).rejects.toThrow(/invalid or has expired/);
    const expired = jwt.sign({ typ: 'verify-link', bid: batch.id, tid: batch.tenantId, exp: 1 }, TEST_JWT_SECRET);
    await expect(t.ctx.traceService.verifyPublic(batch.id, expired)).rejects.toThrow(/invalid or has expired/);
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
    // ...and the current format continues the same chain.
    const admin = await createActor(t, tenant, 'ADMIN');
    await t.ctx.supplyChainService.recordEvent(admin, { batchId: batch.id, stage: 'PROCESSING', location: 'v3' });

    const { token } = await t.ctx.traceService.createVerificationLink(admin, batch.id, 1);
    const result = await t.ctx.traceService.verifyPublic(batch.id, token);
    expect(result.serverCheck.valid).toBe(true);
    expect(result.events.map((e) => e.hashVersion)).toEqual([1, 3]);
    // Publicly, the v1 event carries no content at all — only its hash and link.
    const pub = await t.ctx.traceService.verifyPublic(batch.id);
    expect(pub.events[0]).not.toHaveProperty('disclosure');
    expect(pub.serverCheck.valid).toBe(true);
  });
});
