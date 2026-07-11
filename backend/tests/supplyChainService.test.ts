import { Actor } from '../src/domain/types';
import { InMemoryActorRepo } from '../src/repository/memory/actorRepo';
import { InMemoryAnomalyRepo } from '../src/repository/memory/anomalyRepo';
import { InMemoryAuditLogRepo } from '../src/repository/memory/auditLogRepo';
import { InMemoryBatchRepo } from '../src/repository/memory/batchRepo';
import { InMemoryEventRepo } from '../src/repository/memory/eventRepo';
import { ConflictError, ForbiddenError, NotFoundError, SupplyChainService } from '../src/services/supplyChainService';

function makeActor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: 'actor-1',
    name: 'Test Actor',
    email: 'actor@test.com',
    passwordHash: 'x',
    role: 'FARMER',
    organization: 'Org',
    tenantId: 'tenant-1',
    createdAt: new Date(),
    isActive: true,
    ...overrides,
  };
}

function makeService() {
  const batchRepo = new InMemoryBatchRepo();
  const eventRepo = new InMemoryEventRepo();
  const anomalyRepo = new InMemoryAnomalyRepo();
  const auditLogRepo = new InMemoryAuditLogRepo();
  const actorRepo = new InMemoryActorRepo();
  return {
    batchRepo,
    eventRepo,
    anomalyRepo,
    auditLogRepo,
    actorRepo,
    service: new SupplyChainService(batchRepo, eventRepo, anomalyRepo, auditLogRepo, actorRepo, 'test-signing-key'),
  };
}

/** Creates an actor AND persists it, for use as a recordEvent caller or assignNextTo target. */
async function persistActor(actorRepo: InMemoryActorRepo, overrides: Partial<Actor> = {}): Promise<Actor> {
  const actor = makeActor(overrides);
  await actorRepo.create(actor);
  return actor;
}

describe('SupplyChainService', () => {
  it('creates a batch with no current stage yet, assigned to its creator', async () => {
    const { service } = makeService();
    const farmer = makeActor({ role: 'FARMER' });
    const batch = await service.createBatch(farmer, {
      productName: 'Cà phê', productType: 'Nông sản', origin: 'Đà Lạt', quantity: 100, unit: 'kg',
    });
    expect(batch.currentStage).toBeNull();
    expect(batch.isRecalled).toBe(false);
    expect(batch.createdBy).toBe(farmer.id);
    expect(batch.assignedToActorId).toBe(farmer.id);
  });

  it('records an event and advances currentStage, handing off custody to the named next actor', async () => {
    const { service, actorRepo } = makeService();
    const farmer = await persistActor(actorRepo, { role: 'FARMER' });
    const processor = await persistActor(actorRepo, { id: 'actor-2', role: 'PROCESSOR' });
    const batch = await service.createBatch(farmer, {
      productName: 'Cà phê', productType: 'Nông sản', origin: 'Đà Lạt', quantity: 100, unit: 'kg',
    });
    const event = await service.recordEvent(farmer, {
      batchId: batch.id, stage: 'HARVEST', location: 'Đà Lạt', assignNextTo: processor.id,
    });
    expect(event.sequenceNumber).toBe(0);

    const updated = await service.getBatch(farmer, batch.id);
    expect(updated.currentStage).toBe('HARVEST');
    expect(updated.assignedToActorId).toBe(processor.id);
  });

  it('chains prevHash across consecutive events on the same batch', async () => {
    const { service, actorRepo } = makeService();
    const farmer = await persistActor(actorRepo, { role: 'FARMER' });
    const processor = await persistActor(actorRepo, { id: 'actor-2', role: 'PROCESSOR' });
    const inspector = await persistActor(actorRepo, { id: 'actor-3', role: 'INSPECTOR' });
    const batch = await service.createBatch(farmer, {
      productName: 'Cà phê', productType: 'Nông sản', origin: 'Đà Lạt', quantity: 100, unit: 'kg',
    });
    const e1 = await service.recordEvent(farmer, {
      batchId: batch.id, stage: 'HARVEST', location: 'Đà Lạt', assignNextTo: processor.id,
    });
    const e2 = await service.recordEvent(processor, {
      batchId: batch.id, stage: 'PROCESSING', location: 'Xưởng', assignNextTo: inspector.id,
    });
    expect(e2.prevHash).toBe(e1.hash);
    expect(e2.sequenceNumber).toBe(1);
  });

  it('rejects recording a stage the role is not permitted to record', async () => {
    const { service } = makeService();
    const farmer = makeActor({ role: 'FARMER' });
    const batch = await service.createBatch(farmer, {
      productName: 'Cà phê', productType: 'Nông sản', origin: 'Đà Lạt', quantity: 100, unit: 'kg',
    });
    await expect(
      service.recordEvent(farmer, { batchId: batch.id, stage: 'RETAIL', location: 'Siêu thị' }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('rejects an actor who is not the batch\'s current custodian, even with the right role', async () => {
    const { service, actorRepo } = makeService();
    const farmer = await persistActor(actorRepo, { role: 'FARMER' });
    const unrelatedFarmer = await persistActor(actorRepo, { id: 'actor-9', role: 'FARMER', organization: 'Unrelated Farm' });
    const batch = await service.createBatch(farmer, {
      productName: 'Cà phê', productType: 'Nông sản', origin: 'Đà Lạt', quantity: 100, unit: 'kg',
    });
    await expect(
      service.recordEvent(unrelatedFarmer, { batchId: batch.id, stage: 'HARVEST', location: 'x' }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('lets ADMIN record an event on any batch regardless of assignment', async () => {
    const { service, actorRepo } = makeService();
    const farmer = await persistActor(actorRepo, { role: 'FARMER' });
    const admin = await persistActor(actorRepo, { id: 'admin-1', role: 'ADMIN' });
    const batch = await service.createBatch(farmer, {
      productName: 'Cà phê', productType: 'Nông sản', origin: 'Đà Lạt', quantity: 100, unit: 'kg',
    });
    const event = await service.recordEvent(admin, { batchId: batch.id, stage: 'HARVEST', location: 'x' });
    expect(event.actorId).toBe(admin.id);
  });

  it('requires assignNextTo for a non-ADMIN actor advancing to a non-terminal stage', async () => {
    const { service, actorRepo } = makeService();
    const farmer = await persistActor(actorRepo, { role: 'FARMER' });
    const batch = await service.createBatch(farmer, {
      productName: 'Cà phê', productType: 'Nông sản', origin: 'Đà Lạt', quantity: 100, unit: 'kg',
    });
    await expect(
      service.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'x' }),
    ).rejects.toThrow(ConflictError);
  });

  it('rejects assignNextTo pointing to an actor whose role cannot handle the next stage', async () => {
    const { service, actorRepo } = makeService();
    const farmer = await persistActor(actorRepo, { role: 'FARMER' });
    const retailer = await persistActor(actorRepo, { id: 'actor-5', role: 'RETAILER' });
    const batch = await service.createBatch(farmer, {
      productName: 'Cà phê', productType: 'Nông sản', origin: 'Đà Lạt', quantity: 100, unit: 'kg',
    });
    await expect(
      service.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'x', assignNextTo: retailer.id }),
    ).rejects.toThrow(ConflictError);
  });

  it('clears the assignment once the terminal RETAIL stage is recorded — chain complete', async () => {
    const { service, actorRepo } = makeService();
    const retailer = await persistActor(actorRepo, { role: 'RETAILER' });
    const admin = await persistActor(actorRepo, { id: 'admin-1', role: 'ADMIN' });
    const batch = await service.createBatch(admin, {
      productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg',
    });
    // Fast-forward straight to a state where RETAILER is next, then hand off to them explicitly.
    await service.recordEvent(admin, { batchId: batch.id, stage: 'DISTRIBUTION', location: 'x', assignNextTo: retailer.id });
    await service.recordEvent(retailer, { batchId: batch.id, stage: 'RETAIL', location: 'x' });

    const updated = await service.getBatch(admin, batch.id);
    expect(updated.assignedToActorId).toBeUndefined();
  });

  it('rejects recording an event on a recalled batch', async () => {
    const { service } = makeService();
    const farmer = makeActor({ role: 'FARMER' });
    const admin = makeActor({ id: 'admin-1', role: 'ADMIN' });
    const batch = await service.createBatch(farmer, {
      productName: 'Cà phê', productType: 'Nông sản', origin: 'Đà Lạt', quantity: 100, unit: 'kg',
    });
    await service.recallBatch(admin, batch.id, 'Nhiễm khuẩn');
    await expect(
      service.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'Đà Lạt' }),
    ).rejects.toThrow(ConflictError);
  });

  it('throws NotFoundError for a nonexistent batch', async () => {
    const { service } = makeService();
    const farmer = makeActor({ role: 'FARMER' });
    await expect(
      service.recordEvent(farmer, { batchId: 'nope', stage: 'HARVEST', location: 'x' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('marks a batch recalled with a reason and logs it in the audit log', async () => {
    const { service, auditLogRepo } = makeService();
    const farmer = makeActor({ role: 'FARMER' });
    const admin = makeActor({ id: 'admin-1', role: 'ADMIN' });
    const batch = await service.createBatch(farmer, {
      productName: 'Cà phê', productType: 'Nông sản', origin: 'Đà Lạt', quantity: 100, unit: 'kg',
    });
    const recalled = await service.recallBatch(admin, batch.id, 'Nhiễm khuẩn');
    expect(recalled.isRecalled).toBe(true);
    expect(recalled.recallReason).toBe('Nhiễm khuẩn');

    const { items } = await auditLogRepo.findPageByTenant(admin.tenantId, 1, 20);
    expect(items.some((e) => e.action === 'BATCH_RECALLED' && e.entityId === batch.id)).toBe(true);
  });

  it('lists all created batches', async () => {
    const { service } = makeService();
    const farmer = makeActor({ role: 'FARMER' });
    await service.createBatch(farmer, { productName: 'A', productType: 'x', origin: 'x', quantity: 1, unit: 'kg' });
    await service.createBatch(farmer, { productName: 'B', productType: 'x', origin: 'x', quantity: 1, unit: 'kg' });
    const all = await service.listBatches(farmer);
    expect(all).toHaveLength(2);
  });

  it('paginates and searches batches', async () => {
    const { service } = makeService();
    const farmer = makeActor({ role: 'FARMER' });
    await service.createBatch(farmer, { productName: 'Cà phê', productType: 'x', origin: 'Đà Lạt', quantity: 1, unit: 'kg' });
    await service.createBatch(farmer, { productName: 'Xoài', productType: 'x', origin: 'Tiền Giang', quantity: 1, unit: 'kg' });

    const page = await service.listBatchesPage(farmer, { page: 1, pageSize: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(2);

    const searched = await service.listBatchesPage(farmer, { page: 1, pageSize: 20, search: 'Xoài' });
    expect(searched.items).toHaveLength(1);
    expect(searched.items[0].productName).toBe('Xoài');
  });

  it('does not let currentStage regress when a duplicate/earlier stage is recorded', async () => {
    const { service } = makeService();
    const admin = makeActor({ role: 'ADMIN' });
    const batch = await service.createBatch(admin, {
      productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg',
    });
    await service.recordEvent(admin, { batchId: batch.id, stage: 'HARVEST', location: 'x' });
    await service.recordEvent(admin, { batchId: batch.id, stage: 'PROCESSING', location: 'x' });
    // Re-recording an earlier stage is an anomaly, but currentStage must stay at the furthest stage reached.
    await service.recordEvent(admin, { batchId: batch.id, stage: 'HARVEST', location: 'x' });

    const updated = await service.getBatch(admin, batch.id);
    expect(updated.currentStage).toBe('PROCESSING');
  });

  it('persists the anomalies introduced by a newly recorded event', async () => {
    const { service, anomalyRepo } = makeService();
    const admin = makeActor({ role: 'ADMIN' });
    const batch = await service.createBatch(admin, {
      productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg',
    });
    await service.recordEvent(admin, { batchId: batch.id, stage: 'HARVEST', location: 'x' });
    await service.recordEvent(admin, { batchId: batch.id, stage: 'PACKAGING', location: 'x' }); // skips stages

    const stored = await anomalyRepo.findByBatchId(batch.id);
    expect(stored.some((a) => a.type === 'STAGE_SKIPPED')).toBe(true);
  });

  it('keeps a consistent hash chain under concurrent recordEvent calls on the same batch', async () => {
    const { service } = makeService();
    const admin = makeActor({ role: 'ADMIN' });
    const batch = await service.createBatch(admin, {
      productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg',
    });

    const [e1, e2, e3] = await Promise.all([
      service.recordEvent(admin, { batchId: batch.id, stage: 'HARVEST', location: 'a' }),
      service.recordEvent(admin, { batchId: batch.id, stage: 'PROCESSING', location: 'b' }),
      service.recordEvent(admin, { batchId: batch.id, stage: 'QUALITY_CHECK', location: 'c' }),
    ]);

    const sequenceNumbers = [e1, e2, e3].map((e) => e.sequenceNumber).sort((a, b) => a - b);
    expect(sequenceNumbers).toEqual([0, 1, 2]);

    const events = [e1, e2, e3].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].prevHash).toBe(events[i - 1].hash);
    }
  });
});
