import { Actor } from '../src/domain/types';
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
    createdAt: new Date(),
    isActive: true,
    ...overrides,
  };
}

function makeService() {
  const batchRepo = new InMemoryBatchRepo();
  const eventRepo = new InMemoryEventRepo();
  return { batchRepo, eventRepo, service: new SupplyChainService(batchRepo, eventRepo) };
}

describe('SupplyChainService', () => {
  it('creates a batch with no current stage yet', async () => {
    const { service } = makeService();
    const farmer = makeActor({ role: 'FARMER' });
    const batch = await service.createBatch(farmer, {
      productName: 'Cà phê', productType: 'Nông sản', origin: 'Đà Lạt', quantity: 100, unit: 'kg',
    });
    expect(batch.currentStage).toBeNull();
    expect(batch.isRecalled).toBe(false);
    expect(batch.createdBy).toBe(farmer.id);
  });

  it('records an event and advances currentStage', async () => {
    const { service } = makeService();
    const farmer = makeActor({ role: 'FARMER' });
    const batch = await service.createBatch(farmer, {
      productName: 'Cà phê', productType: 'Nông sản', origin: 'Đà Lạt', quantity: 100, unit: 'kg',
    });
    const event = await service.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'Đà Lạt' });
    expect(event.sequenceNumber).toBe(0);

    const updated = await service.getBatch(batch.id);
    expect(updated.currentStage).toBe('HARVEST');
  });

  it('chains prevHash across consecutive events on the same batch', async () => {
    const { service } = makeService();
    const farmer = makeActor({ role: 'FARMER' });
    const processor = makeActor({ id: 'actor-2', role: 'PROCESSOR' });
    const batch = await service.createBatch(farmer, {
      productName: 'Cà phê', productType: 'Nông sản', origin: 'Đà Lạt', quantity: 100, unit: 'kg',
    });
    const e1 = await service.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'Đà Lạt' });
    const e2 = await service.recordEvent(processor, { batchId: batch.id, stage: 'PROCESSING', location: 'Xưởng' });
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

  it('rejects recording an event on a recalled batch', async () => {
    const { service } = makeService();
    const farmer = makeActor({ role: 'FARMER' });
    const batch = await service.createBatch(farmer, {
      productName: 'Cà phê', productType: 'Nông sản', origin: 'Đà Lạt', quantity: 100, unit: 'kg',
    });
    await service.recallBatch(batch.id, 'Nhiễm khuẩn');
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

  it('marks a batch recalled with a reason', async () => {
    const { service } = makeService();
    const farmer = makeActor({ role: 'FARMER' });
    const batch = await service.createBatch(farmer, {
      productName: 'Cà phê', productType: 'Nông sản', origin: 'Đà Lạt', quantity: 100, unit: 'kg',
    });
    const recalled = await service.recallBatch(batch.id, 'Nhiễm khuẩn');
    expect(recalled.isRecalled).toBe(true);
    expect(recalled.recallReason).toBe('Nhiễm khuẩn');
  });

  it('lists all created batches', async () => {
    const { service } = makeService();
    const farmer = makeActor({ role: 'FARMER' });
    await service.createBatch(farmer, { productName: 'A', productType: 'x', origin: 'x', quantity: 1, unit: 'kg' });
    await service.createBatch(farmer, { productName: 'B', productType: 'x', origin: 'x', quantity: 1, unit: 'kg' });
    const all = await service.listBatches();
    expect(all).toHaveLength(2);
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

    const updated = await service.getBatch(batch.id);
    expect(updated.currentStage).toBe('PROCESSING');
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
