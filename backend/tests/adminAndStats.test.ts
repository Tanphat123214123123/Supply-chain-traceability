import { ConflictError, ForbiddenError, NotFoundError } from '../src/errors';
import { asAttacker, createActor, createTenant, sampleBatch, TestDb, useTestDatabase } from './helpers/testDb';

const getDb = useTestDatabase();

async function world(t: TestDb) {
  const tenant = await createTenant(t);
  const farmer = await createActor(t, tenant, 'FARMER');
  const otherFarmer = await createActor(t, tenant, 'FARMER');
  const processor = await createActor(t, tenant, 'PROCESSOR');
  const inspector = await createActor(t, tenant, 'INSPECTOR');
  const admin = await createActor(t, tenant, 'ADMIN');
  return { tenant, farmer, otherFarmer, processor, inspector, admin };
}

describe('StatsService (aggregated in SQL)', () => {
  it('computes overview, by-stage, by-day and by-origin for one tenant only', async () => {
    const t = getDb();
    const { farmer, admin, processor } = await world(t);
    const svc = t.ctx.supplyChainService;

    const a = await svc.createBatch(farmer, { ...sampleBatch, origin: 'Lâm Đồng' });
    const b = await svc.createBatch(farmer, { ...sampleBatch, origin: 'Lâm Đồng' });
    const c = await svc.createBatch(admin, { ...sampleBatch, origin: 'Đắk Lắk' });
    await svc.recordEvent(farmer, { batchId: a.id, stage: 'HARVEST', location: 'x', assignNextTo: processor.id });
    await svc.recordEvent(admin, { batchId: c.id, stage: 'HARVEST', location: 'x' });
    await svc.recordEvent(admin, { batchId: c.id, stage: 'PACKAGING', location: 'x' }); // STAGE_SKIPPED
    await svc.recallBatch(admin, b.id, 'test');

    // Noise in another tenant must not leak into any number.
    const outsider = await createActor(t, await createTenant(t), 'ADMIN');
    const foreign = await svc.createBatch(outsider, sampleBatch);
    await svc.recordEvent(outsider, { batchId: foreign.id, stage: 'HARVEST', location: 'x' });

    const stats = t.ctx.statsService;
    expect(await stats.overview(farmer.tenantId)).toEqual({
      totalBatches: 3,
      activeBatches: 2,
      recalledBatches: 1,
      totalEvents: 3,
      anomalyCount: 1,
      openAnomalyCount: 1,
    });

    const byStage = await stats.byStage(farmer.tenantId);
    expect(byStage.find((s) => s.stage === 'HARVEST')?.count).toBe(2);
    expect(byStage.find((s) => s.stage === 'PACKAGING')?.count).toBe(1);
    expect(byStage).toHaveLength(6);

    const today = new Date().toISOString().slice(0, 10);
    expect(await stats.byDay(farmer.tenantId)).toEqual([{ date: today, count: 3 }]);

    expect(await stats.byOrigin(farmer.tenantId)).toEqual([
      { origin: 'Lâm Đồng', batchCount: 2, anomalyCount: 0 },
      { origin: 'Đắk Lắk', batchCount: 1, anomalyCount: 1 },
    ]);
  });

  it('flags batches with no activity for days as stalled — never recalled or finished ones', async () => {
    const t = getDb();
    const { farmer, admin, processor } = await world(t);
    const svc = t.ctx.supplyChainService;

    const stuck = await svc.createBatch(farmer, sampleBatch);
    await svc.recordEvent(farmer, { batchId: stuck.id, stage: 'HARVEST', location: 'x', assignNextTo: processor.id });
    const fresh = await svc.createBatch(farmer, sampleBatch);
    const recalled = await svc.createBatch(farmer, sampleBatch);
    await svc.recallBatch(admin, recalled.id, 'x');
    const untouched = await svc.createBatch(farmer, sampleBatch);

    // Age everything except `fresh` past the threshold, bypassing the append-only ledger guard as the owner.
    const client = await t.ownerPool.connect();
    try {
      await client.query('SET session_replication_role = replica');
      await client.query("UPDATE trace_events SET timestamp = now() - interval '5 days'");
      await client.query("UPDATE batches SET created_at = now() - interval '6 days' WHERE id <> $1", [fresh.id]);
    } finally {
      await client.query('RESET session_replication_role');
      client.release();
    }

    const attention = await t.ctx.statsService.attention(farmer.tenantId);
    expect(attention.stalledBatches.map((b) => b.id)).toEqual([untouched.id, stuck.id]);
    expect(attention.stalledCount).toBe(2);
    expect(attention.stalledBatches[1].lastEventAt).toBeInstanceOf(Date);
  });

  it('filters the batch list by current stage, with NONE for not-yet-started batches', async () => {
    const t = getDb();
    const { farmer, processor } = await world(t);
    const svc = t.ctx.supplyChainService;
    const harvested = await svc.createBatch(farmer, sampleBatch);
    await svc.recordEvent(farmer, { batchId: harvested.id, stage: 'HARVEST', location: 'x', assignNextTo: processor.id });
    const notStarted = await svc.createBatch(farmer, sampleBatch);

    const byStage = await svc.listBatchesPage(farmer, { page: 1, pageSize: 10, stage: 'HARVEST' });
    expect(byStage.items.map((b) => b.id)).toEqual([harvested.id]);
    const none = await svc.listBatchesPage(farmer, { page: 1, pageSize: 10, stage: 'NONE' });
    expect(none.items.map((b) => b.id)).toEqual([notStarted.id]);
  });
});

describe('AdminService', () => {
  it('scopes notifications: oversight roles see the tenant, others only batches they are involved in', async () => {
    const t = getDb();
    const { farmer, otherFarmer, inspector, admin } = await world(t);
    const svc = t.ctx.supplyChainService;
    const farmersBatch = await svc.createBatch(farmer, sampleBatch);
    const othersBatch = await svc.createBatch(otherFarmer, sampleBatch);
    await svc.recallBatch(admin, farmersBatch.id, 'mine');
    await svc.recallBatch(admin, othersBatch.id, 'theirs');

    const forFarmer = await t.ctx.adminService.listNotifications(20, farmer);
    expect(forFarmer.map((n) => n.batchId)).toEqual([farmersBatch.id]);

    const forInspector = await t.ctx.adminService.listNotifications(20, inspector);
    expect(new Set(forInspector.map((n) => n.batchId))).toEqual(new Set([farmersBatch.id, othersBatch.id]));
  });

  it('applies the limit AFTER the visibility filter (a busy tenant cannot starve my feed)', async () => {
    const t = getDb();
    const { farmer, otherFarmer, admin } = await world(t);
    const svc = t.ctx.supplyChainService;
    const mine = await svc.createBatch(farmer, sampleBatch);
    await svc.recallBatch(admin, mine.id, 'mine');
    for (let i = 0; i < 5; i++) {
      const other = await svc.createBatch(otherFarmer, sampleBatch);
      await svc.recallBatch(admin, other.id, `other ${i}`);
    }
    const feed = await t.ctx.adminService.listNotifications(2, farmer);
    expect(feed.map((n) => n.batchId)).toEqual([mine.id]);
  });

  it('returns an actor detail with the batches they created, hold, or touched', async () => {
    const t = getDb();
    const { farmer, processor, admin } = await world(t);
    const svc = t.ctx.supplyChainService;
    const created = await svc.createBatch(farmer, sampleBatch);
    await svc.recordEvent(farmer, { batchId: created.id, stage: 'HARVEST', location: 'x', assignNextTo: processor.id });
    await svc.createBatch(admin, sampleBatch); // unrelated to the processor

    const detail = await t.ctx.adminService.getActorDetail(processor.id, admin);
    expect(detail.batches.map((b) => b.id)).toEqual([created.id]); // via current custody
    expect(detail.actor.email).toBe(processor.email); // ADMIN sees emails

    const asFarmer = await t.ctx.adminService.getActorDetail(processor.id, farmer);
    expect(asFarmer.actor.email).toBeUndefined(); // redacted for non-admins
  });

  it('changes role/status within the tenant only, with self-protection', async () => {
    const t = getDb();
    const { farmer, admin } = await world(t);
    const outsider = await createActor(t, await createTenant(t), 'FARMER');
    const admins = t.ctx.adminService;

    await expect(admins.setActorRole(admin, farmer.id, 'DISTRIBUTOR')).resolves.toMatchObject({ role: 'DISTRIBUTOR' });
    await expect(admins.setActorRole(admin, admin.id, 'FARMER')).rejects.toThrow(ForbiddenError);
    await expect(admins.setActorStatus(admin, admin.id, false)).rejects.toThrow(ForbiddenError);
    await expect(admins.setActorStatus(admin, outsider.id, false)).rejects.toThrow(NotFoundError);
    await expect(admins.setActorRole(admin, outsider.id, 'ADMIN')).rejects.toThrow(NotFoundError);
  });

  it('resolves an anomaly once; a second resolve is a conflict', async () => {
    const t = getDb();
    const { admin } = await world(t);
    const batch = await t.ctx.supplyChainService.createBatch(admin, sampleBatch);
    await t.ctx.supplyChainService.recordEvent(admin, { batchId: batch.id, stage: 'HARVEST', location: 'x' });
    await t.ctx.supplyChainService.recordEvent(admin, { batchId: batch.id, stage: 'HARVEST', location: 'x' });
    const [anomaly] = (await t.ctx.adminService.listAnomalies(admin, { page: 1, pageSize: 10 })).items;

    await expect(t.ctx.adminService.resolveAnomaly(admin, anomaly.id)).resolves.toMatchObject({
      resolved: true,
      resolvedBy: admin.id,
    });
    await expect(t.ctx.adminService.resolveAnomaly(admin, anomaly.id)).rejects.toThrow(ConflictError);

    const open = await t.ctx.adminService.listAnomalies(admin, { page: 1, pageSize: 10, resolved: false });
    expect(open.total).toBe(0);
  });

  describe('integrity scan', () => {
    async function twoBatches(t: TestDb) {
      const w = await world(t);
      const svc = t.ctx.supplyChainService;
      const edited = await svc.createBatch(w.admin, { ...sampleBatch, productName: 'edited' });
      const truncated = await svc.createBatch(w.admin, { ...sampleBatch, productName: 'truncated' });
      const clean = await svc.createBatch(w.admin, { ...sampleBatch, productName: 'clean' });
      for (const b of [edited, truncated, clean]) {
        await svc.recordEvent(w.admin, { batchId: b.id, stage: 'HARVEST', location: 'x' });
        await svc.recordEvent(w.admin, { batchId: b.id, stage: 'PROCESSING', location: 'y' });
      }
      return { ...w, edited, truncated, clean };
    }

    it('flags an edited chain and a truncated chain, but not a clean one — and is idempotent', async () => {
      const t = getDb();
      const { admin, edited, truncated } = await twoBatches(t);
      await asAttacker(t, "UPDATE trace_events SET notes = 'forged' WHERE batch_id = $1 AND sequence_number = 0", [edited.id]);
      await asAttacker(t, 'DELETE FROM trace_events WHERE batch_id = $1 AND sequence_number = 1', [truncated.id]);

      const flagged = await t.ctx.adminService.scanForTamperedChains();
      expect(new Set(flagged.map((a) => a.batchId))).toEqual(new Set([edited.id, truncated.id]));
      expect(flagged.every((a) => a.type === 'CHAIN_TAMPERED' && a.severity === 'CRITICAL')).toBe(true);

      // Running again (another replica booting, or the admin button) adds nothing.
      expect(await t.ctx.adminService.scanForTamperedChains()).toHaveLength(0);
      // Concurrent scans can't double-report either (unique partial index).
      await Promise.all([t.ctx.adminService.scanForTamperedChains(), t.ctx.adminService.scanForTamperedChains()]);
      const open = await t.ctx.adminService.listAnomalies(admin, { page: 1, pageSize: 50, resolved: false });
      expect(open.items.filter((a) => a.type === 'CHAIN_TAMPERED')).toHaveLength(2);
    });

    it('re-flags a still-broken chain after its previous alert was resolved', async () => {
      const t = getDb();
      const { admin, edited } = await twoBatches(t);
      await asAttacker(t, "UPDATE trace_events SET location = 'forged' WHERE batch_id = $1", [edited.id]);
      const [first] = await t.ctx.adminService.scanForTamperedChains();
      await t.ctx.adminService.resolveAnomaly(admin, first.id);
      expect(await t.ctx.adminService.scanForTamperedChains()).toHaveLength(1);
    });

    it('limits the on-demand scan to the requesting tenant', async () => {
      const t = getDb();
      const mine = await twoBatches(t);
      const theirs = await twoBatches(t);
      await asAttacker(t, "UPDATE trace_events SET location = 'forged' WHERE batch_id = $1", [theirs.edited.id]);

      expect(await t.ctx.adminService.scanForTamperedChains(mine.tenant.id)).toHaveLength(0);
      expect(await t.ctx.adminService.scanForTamperedChains(theirs.tenant.id)).toHaveLength(1);
    });
  });
});
