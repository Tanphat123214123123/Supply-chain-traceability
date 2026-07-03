import { Actor } from '../src/domain/types';
import { InMemoryBatchRepo } from '../src/repository/memory/batchRepo';
import { InMemoryEventRepo } from '../src/repository/memory/eventRepo';
import { SupplyChainService } from '../src/services/supplyChainService';
import { TraceService } from '../src/services/traceService';

function makeActor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: 'actor-1', name: 'Test', email: 'a@test.com', passwordHash: 'x',
    role: 'FARMER', organization: 'Org', createdAt: new Date(), isActive: true,
    ...overrides,
  };
}

function makeContext() {
  const batchRepo = new InMemoryBatchRepo();
  const eventRepo = new InMemoryEventRepo();
  return {
    batchRepo,
    eventRepo,
    supplyChain: new SupplyChainService(batchRepo, eventRepo),
    traceService: new TraceService(batchRepo, eventRepo),
  };
}

describe('TraceService', () => {
  it('traces forward in ascending sequence order', async () => {
    const { supplyChain, traceService } = makeContext();
    const farmer = makeActor({ role: 'FARMER' });
    const processor = makeActor({ id: 'a2', role: 'PROCESSOR' });
    const batch = await supplyChain.createBatch(farmer, {
      productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg',
    });
    await supplyChain.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'x' });
    await supplyChain.recordEvent(processor, { batchId: batch.id, stage: 'PROCESSING', location: 'x' });

    const result = await traceService.trace(batch.id, 'forward');
    expect(result.events.map((e) => e.stage)).toEqual(['HARVEST', 'PROCESSING']);
    expect(result.isValid).toBe(true);
    expect(result.anomalies).toHaveLength(0);
  });

  it('traces backward in descending sequence order', async () => {
    const { supplyChain, traceService } = makeContext();
    const farmer = makeActor({ role: 'FARMER' });
    const processor = makeActor({ id: 'a2', role: 'PROCESSOR' });
    const batch = await supplyChain.createBatch(farmer, {
      productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg',
    });
    await supplyChain.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'x' });
    await supplyChain.recordEvent(processor, { batchId: batch.id, stage: 'PROCESSING', location: 'x' });

    const result = await traceService.trace(batch.id, 'backward');
    expect(result.events.map((e) => e.stage)).toEqual(['PROCESSING', 'HARVEST']);
  });

  it('flags the chain invalid once an event is tampered with', async () => {
    const { supplyChain, traceService } = makeContext();
    const farmer = makeActor({ role: 'FARMER' });
    const batch = await supplyChain.createBatch(farmer, {
      productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg',
    });
    const event = await supplyChain.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'x' });

    event.location = 'TAMPERED'; // mutate the stored event in place (same object reference)

    const result = await traceService.trace(batch.id);
    expect(result.isValid).toBe(false);
  });

  it('surfaces anomalies detected across the batch history', async () => {
    const { supplyChain, traceService } = makeContext();
    const admin = makeActor({ role: 'ADMIN' });
    const batch = await supplyChain.createBatch(admin, {
      productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg',
    });
    await supplyChain.recordEvent(admin, { batchId: batch.id, stage: 'HARVEST', location: 'x' });
    await supplyChain.recordEvent(admin, { batchId: batch.id, stage: 'PACKAGING', location: 'x' }); // skips stages

    const result = await traceService.trace(batch.id);
    expect(result.anomalies.some((a) => a.type === 'STAGE_SKIPPED')).toBe(true);
  });

  it('throws for an unknown batch', async () => {
    const { traceService } = makeContext();
    await expect(traceService.trace('missing')).rejects.toThrow();
  });

  it('builds a public trace without exposing internal batch fields', async () => {
    const { supplyChain, traceService } = makeContext();
    const farmer = makeActor({ role: 'FARMER' });
    const batch = await supplyChain.createBatch(farmer, {
      productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg',
    });
    await supplyChain.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'x' });

    const publicTrace = await traceService.publicTrace(batch.id);
    expect(publicTrace.stageCount).toBe(1);
    expect(publicTrace.isValid).toBe(true);
    expect((publicTrace.batch as Record<string, unknown>).createdBy).toBeUndefined();
  });
});
