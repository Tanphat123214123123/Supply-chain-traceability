import { v4 as uuidv4 } from 'uuid';
import { verifyChain } from '../src/ledger/hashChain';
import { PostgresEventRepo } from '../src/repository/postgres/eventRepo';
import { ConflictError, ForbiddenError, NotFoundError } from '../src/services/supplyChainService';
import { createActor, createTenant, sampleBatch, TestDb, useTestDatabase } from './helpers/testDb';

const getDb = useTestDatabase();

async function setup(t: TestDb) {
  const tenant = await createTenant(t);
  const farmer = await createActor(t, tenant, 'FARMER');
  const processor = await createActor(t, tenant, 'PROCESSOR');
  const inspector = await createActor(t, tenant, 'INSPECTOR');
  const retailer = await createActor(t, tenant, 'RETAILER');
  const admin = await createActor(t, tenant, 'ADMIN');
  return { tenant, farmer, processor, inspector, retailer, admin, svc: t.ctx.supplyChainService };
}

describe('SupplyChainService', () => {
  it('creates a batch with no current stage yet, assigned to its creator, chain at genesis', async () => {
    const { farmer, svc } = await setup(getDb());
    const batch = await svc.createBatch(farmer, sampleBatch);
    expect(batch).toMatchObject({
      currentStage: null,
      isRecalled: false,
      createdBy: farmer.id,
      assignedToActorId: farmer.id,
      headHash: '0'.repeat(64),
      eventCount: 0,
    });
  });

  it('records a v3 event, advances the stage and hands custody to the named next actor', async () => {
    const { farmer, processor, svc } = await setup(getDb());
    const batch = await svc.createBatch(farmer, sampleBatch);
    const event = await svc.recordEvent(farmer, {
      batchId: batch.id,
      stage: 'HARVEST',
      location: 'Đắk Lắk',
      data: { moisture: 12.5, lot: 'A-1' },
      assignNextTo: processor.id,
    });
    expect(event).toMatchObject({ sequenceNumber: 0, hashVersion: 3, prevHash: '0'.repeat(64), kind: 'OBSERVE' });
    expect(Object.values(event.claimSalts!).every((s) => /^[0-9a-f]{64}$/.test(s))).toBe(true);

    const updated = await svc.getBatch(farmer, batch.id);
    expect(updated).toMatchObject({
      currentStage: 'HARVEST',
      assignedToActorId: processor.id,
      headHash: event.hash,
      eventCount: 1,
    });
  });

  it('chains prevHash across consecutive events and the stored chain verifies against its head', async () => {
    const t = getDb();
    const { farmer, processor, inspector, svc } = await setup(t);
    const batch = await svc.createBatch(farmer, sampleBatch);
    const e1 = await svc.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'a', assignNextTo: processor.id });
    const e2 = await svc.recordEvent(processor, {
      batchId: batch.id,
      stage: 'PROCESSING',
      location: 'b',
      assignNextTo: inspector.id,
    });
    expect(e2.prevHash).toBe(e1.hash);
    expect(e2.sequenceNumber).toBe(1);

    const stored = await t.db.withTenant(farmer.tenantId, () => new PostgresEventRepo(t.db).findByBatchId(batch.id));
    const head = await svc.getBatch(farmer, batch.id);
    expect(verifyChain(stored, { head: { hash: head.headHash, eventCount: head.eventCount } })).toBe(true);
  });

  it('rejects recording a stage the role is not permitted to record', async () => {
    const { farmer, svc } = await setup(getDb());
    const batch = await svc.createBatch(farmer, sampleBatch);
    await expect(svc.recordEvent(farmer, { batchId: batch.id, stage: 'RETAIL', location: 'x' })).rejects.toThrow(ForbiddenError);
  });

  it("rejects an actor who is not the batch's current custodian, even with the right role", async () => {
    const t = getDb();
    const { tenant, farmer, svc } = await setup(t);
    const otherFarmer = await createActor(t, tenant, 'FARMER');
    const batch = await svc.createBatch(farmer, sampleBatch);
    await expect(svc.recordEvent(otherFarmer, { batchId: batch.id, stage: 'HARVEST', location: 'x' })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('lets ADMIN record an event on any batch of its tenant regardless of assignment', async () => {
    const { farmer, admin, svc } = await setup(getDb());
    const batch = await svc.createBatch(farmer, sampleBatch);
    const event = await svc.recordEvent(admin, { batchId: batch.id, stage: 'HARVEST', location: 'x' });
    expect(event.actorId).toBe(admin.id);
  });

  it('requires assignNextTo for a non-ADMIN actor advancing to a non-terminal stage', async () => {
    const { farmer, svc } = await setup(getDb());
    const batch = await svc.createBatch(farmer, sampleBatch);
    await expect(svc.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'x' })).rejects.toThrow(ConflictError);
  });

  it('rejects assignNextTo pointing at an actor whose role cannot handle the next stage', async () => {
    const { farmer, retailer, svc } = await setup(getDb());
    const batch = await svc.createBatch(farmer, sampleBatch);
    await expect(
      svc.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'x', assignNextTo: retailer.id }),
    ).rejects.toThrow(ConflictError);
  });

  it('rejects assignNextTo pointing at an inactive actor', async () => {
    const t = getDb();
    const { tenant, farmer, svc } = await setup(t);
    const inactive = await createActor(t, tenant, 'PROCESSOR', { isActive: false });
    const batch = await svc.createBatch(farmer, sampleBatch);
    await expect(
      svc.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'x', assignNextTo: inactive.id }),
    ).rejects.toThrow(/inactive/);
  });

  it('rejects assignNextTo pointing at an actor of another tenant', async () => {
    const t = getDb();
    const { farmer, svc } = await setup(t);
    const foreign = await createActor(t, await createTenant(t), 'PROCESSOR');
    const batch = await svc.createBatch(farmer, sampleBatch);
    await expect(
      svc.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'x', assignNextTo: foreign.id }),
    ).rejects.toThrow(NotFoundError);
  });

  it('writes nothing when the hand-off is invalid (whole operation is one transaction)', async () => {
    const t = getDb();
    const { farmer, retailer, svc } = await setup(t);
    const batch = await svc.createBatch(farmer, sampleBatch);
    await expect(
      svc.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'x', assignNextTo: retailer.id }),
    ).rejects.toThrow();
    const after = await svc.getBatch(farmer, batch.id);
    expect(after).toMatchObject({ eventCount: 0, currentStage: null });
  });

  it('clears the assignment once the terminal RETAIL stage is recorded — chain complete', async () => {
    const { retailer, admin, svc } = await setup(getDb());
    const batch = await svc.createBatch(admin, sampleBatch);
    await svc.recordEvent(admin, { batchId: batch.id, stage: 'DISTRIBUTION', location: 'x', assignNextTo: retailer.id });
    await svc.recordEvent(retailer, { batchId: batch.id, stage: 'RETAIL', location: 'x' });
    expect((await svc.getBatch(admin, batch.id)).assignedToActorId).toBeUndefined();
  });

  it('rejects recording an event on a recalled batch', async () => {
    const { farmer, admin, svc } = await setup(getDb());
    const batch = await svc.createBatch(farmer, sampleBatch);
    await svc.recallBatch(admin, batch.id, 'Nhiễm khuẩn');
    await expect(svc.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'x' })).rejects.toThrow(ConflictError);
  });

  it('throws NotFoundError for a nonexistent or malformed batch id', async () => {
    const { farmer, svc } = await setup(getDb());
    await expect(svc.recordEvent(farmer, { batchId: 'nope', stage: 'HARVEST', location: 'x' })).rejects.toThrow(NotFoundError);
    await expect(svc.recordEvent(farmer, { batchId: uuidv4(), stage: 'HARVEST', location: 'x' })).rejects.toThrow(NotFoundError);
  });

  it("cannot see or act on another tenant's batch (404, not 403)", async () => {
    const t = getDb();
    const { farmer, svc } = await setup(t);
    const batch = await svc.createBatch(farmer, sampleBatch);
    const outsiderAdmin = await createActor(t, await createTenant(t), 'ADMIN');
    await expect(svc.getBatch(outsiderAdmin, batch.id)).rejects.toThrow(NotFoundError);
    await expect(svc.recordEvent(outsiderAdmin, { batchId: batch.id, stage: 'HARVEST', location: 'x' })).rejects.toThrow(
      NotFoundError,
    );
    await expect(svc.recallBatch(outsiderAdmin, batch.id, 'x')).rejects.toThrow(NotFoundError);
  });

  it('marks a batch recalled with a reason and logs it in the audit log', async () => {
    const t = getDb();
    const { farmer, admin, svc } = await setup(t);
    const batch = await svc.createBatch(farmer, sampleBatch);
    const recalled = await svc.recallBatch(admin, batch.id, 'Nhiễm khuẩn');
    expect(recalled).toMatchObject({ isRecalled: true, recallReason: 'Nhiễm khuẩn' });

    const { items } = await t.ctx.adminService.listAuditLogs(admin, 1, 20);
    expect(items.some((e) => e.action === 'BATCH_RECALLED' && e.entityId === batch.id)).toBe(true);
  });

  it('refuses to recall an already-recalled batch (keeps the original reason)', async () => {
    const { farmer, admin, svc } = await setup(getDb());
    const batch = await svc.createBatch(farmer, sampleBatch);
    await svc.recallBatch(admin, batch.id, 'first');
    await expect(svc.recallBatch(admin, batch.id, 'second')).rejects.toThrow(ConflictError);
    expect((await svc.getBatch(admin, batch.id)).recallReason).toBe('first');
  });

  it('paginates and searches batches (search treats % and _ literally)', async () => {
    const { farmer, svc } = await setup(getDb());
    await svc.createBatch(farmer, { ...sampleBatch, productName: 'Cà phê', origin: 'Đà Lạt' });
    await svc.createBatch(farmer, { ...sampleBatch, productName: 'Xoài', origin: 'Tiền Giang' });
    await svc.createBatch(farmer, { ...sampleBatch, productName: '100% Arabica', origin: 'Sơn La' });

    const page = await svc.listBatchesPage(farmer, { page: 1, pageSize: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);

    const pastEnd = await svc.listBatchesPage(farmer, { page: 5, pageSize: 2 });
    expect(pastEnd).toMatchObject({ items: [], total: 3 });

    const searched = await svc.listBatchesPage(farmer, { page: 1, pageSize: 20, search: 'xoài' });
    expect(searched.items.map((b) => b.productName)).toEqual(['Xoài']);

    const literalPercent = await svc.listBatchesPage(farmer, { page: 1, pageSize: 20, search: '0%' });
    expect(literalPercent.items.map((b) => b.productName)).toEqual(['100% Arabica']);
    const underscore = await svc.listBatchesPage(farmer, { page: 1, pageSize: 20, search: '_' });
    expect(underscore.total).toBe(0);
  });

  it('lists the work queue: next stage matches role, and the batch is assigned to me or unclaimed', async () => {
    const { farmer, processor, admin, svc } = await setup(getDb());
    const mine = await svc.createBatch(farmer, { ...sampleBatch, productName: 'mine' });
    await svc.createBatch(admin, { ...sampleBatch, productName: 'admins' }); // assigned to admin
    const handed = await svc.createBatch(farmer, { ...sampleBatch, productName: 'handed' });
    await svc.recordEvent(farmer, { batchId: handed.id, stage: 'HARVEST', location: 'x', assignNextTo: processor.id });

    expect((await svc.listPendingForActor(farmer)).map((b) => b.id)).toEqual([mine.id]);
    expect((await svc.listPendingForActor(processor)).map((b) => b.id)).toEqual([handed.id]);
    expect((await svc.listPendingForActor(admin)).length).toBe(3);
  });

  it('exports with date and origin filters', async () => {
    const { farmer, svc } = await setup(getDb());
    await svc.createBatch(farmer, { ...sampleBatch, origin: 'Lâm Đồng' });
    await svc.createBatch(farmer, { ...sampleBatch, origin: 'Đắk Lắk' });
    expect(await svc.exportBatches(farmer, { origin: 'lâm' })).toHaveLength(1);
    expect(await svc.exportBatches(farmer, { from: new Date(Date.now() + 60_000) })).toHaveLength(0);
    expect(await svc.exportBatches(farmer, {})).toHaveLength(2);
  });

  it('does not let currentStage regress when a duplicate/earlier stage is recorded', async () => {
    const { admin, svc } = await setup(getDb());
    const batch = await svc.createBatch(admin, sampleBatch);
    await svc.recordEvent(admin, { batchId: batch.id, stage: 'HARVEST', location: 'x' });
    await svc.recordEvent(admin, { batchId: batch.id, stage: 'PROCESSING', location: 'x' });
    await svc.recordEvent(admin, { batchId: batch.id, stage: 'HARVEST', location: 'x' });
    expect((await svc.getBatch(admin, batch.id)).currentStage).toBe('PROCESSING');
  });

  it('persists the anomalies introduced by a newly recorded event', async () => {
    const t = getDb();
    const { admin, svc } = await setup(t);
    const batch = await svc.createBatch(admin, sampleBatch);
    await svc.recordEvent(admin, { batchId: batch.id, stage: 'HARVEST', location: 'x' });
    await svc.recordEvent(admin, { batchId: batch.id, stage: 'PACKAGING', location: 'x' });
    const { items } = await t.ctx.adminService.listAnomalies(admin, { page: 1, pageSize: 10 });
    expect(items.some((a) => a.type === 'STAGE_SKIPPED' && a.batchId === batch.id)).toBe(true);
  });

  describe('concurrency', () => {
    it('keeps one linear chain under concurrent recordEvent calls on the same batch', async () => {
      const t = getDb();
      const { admin, svc } = await setup(t);
      const batch = await svc.createBatch(admin, sampleBatch);

      const events = await Promise.all(
        (['HARVEST', 'PROCESSING', 'QUALITY_CHECK', 'PACKAGING', 'DISTRIBUTION'] as const).map((stage) =>
          svc.recordEvent(admin, { batchId: batch.id, stage, location: stage }),
        ),
      );

      const sorted = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
      expect(sorted.map((e) => e.sequenceNumber)).toEqual([0, 1, 2, 3, 4]);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i].prevHash).toBe(sorted[i - 1].hash);

      const head = await svc.getBatch(admin, batch.id);
      expect(head).toMatchObject({ eventCount: 5, headHash: sorted[4].hash });
    });

    it('a recall racing an event never loses either write (no lost update on the batch row)', async () => {
      const t = getDb();
      const { farmer, processor, admin, svc } = await setup(t);
      for (let round = 0; round < 5; round++) {
        const batch = await svc.createBatch(farmer, sampleBatch);
        const [eventResult] = await Promise.allSettled([
          svc.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'x', assignNextTo: processor.id }),
          svc.recallBatch(admin, batch.id, 'race'),
        ]);
        const final = await svc.getBatch(admin, batch.id);
        expect(final.isRecalled).toBe(true);
        if (eventResult.status === 'fulfilled') {
          // The event won the lock: its stage advance must survive the recall.
          expect(final).toMatchObject({ currentStage: 'HARVEST', assignedToActorId: processor.id, eventCount: 1 });
        } else {
          expect(eventResult.reason).toBeInstanceOf(ConflictError);
          expect(final).toMatchObject({ currentStage: null, eventCount: 0 });
        }
      }
    });
  });
});
