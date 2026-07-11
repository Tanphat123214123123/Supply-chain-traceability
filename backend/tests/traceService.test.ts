import { Actor } from '../src/domain/types';
import { InMemoryActorRepo } from '../src/repository/memory/actorRepo';
import { InMemoryAnomalyRepo } from '../src/repository/memory/anomalyRepo';
import { InMemoryAuditLogRepo } from '../src/repository/memory/auditLogRepo';
import { InMemoryBatchRepo } from '../src/repository/memory/batchRepo';
import { InMemoryEventRepo } from '../src/repository/memory/eventRepo';
import { SupplyChainService } from '../src/services/supplyChainService';
import { TraceService } from '../src/services/traceService';

function makeActor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: 'actor-1', name: 'Test', email: 'a@test.com', passwordHash: 'x',
    role: 'FARMER', organization: 'Org', tenantId: 'tenant-1', createdAt: new Date(), isActive: true,
    ...overrides,
  };
}

function makeContext() {
  const batchRepo = new InMemoryBatchRepo();
  const eventRepo = new InMemoryEventRepo();
  const anomalyRepo = new InMemoryAnomalyRepo();
  const auditLogRepo = new InMemoryAuditLogRepo();
  const actorRepo = new InMemoryActorRepo();
  return {
    batchRepo,
    eventRepo,
    actorRepo,
    supplyChain: new SupplyChainService(batchRepo, eventRepo, anomalyRepo, auditLogRepo, actorRepo, 'test-signing-key'),
    traceService: new TraceService(batchRepo, eventRepo, anomalyRepo, 'test-signing-key'),
  };
}

/** Creates an actor AND persists it, for use as a recordEvent caller or assignNextTo target. */
async function persistActor(actorRepo: InMemoryActorRepo, overrides: Partial<Actor> = {}): Promise<Actor> {
  const actor = makeActor(overrides);
  await actorRepo.create(actor);
  return actor;
}

describe('TraceService', () => {
  it('traces forward in ascending sequence order', async () => {
    const { supplyChain, traceService, actorRepo } = makeContext();
    const farmer = await persistActor(actorRepo, { role: 'FARMER' });
    const processor = await persistActor(actorRepo, { id: 'a2', role: 'PROCESSOR' });
    // ADMIN's role satisfies every stage, so it's a convenient assignNextTo
    // target for tests that don't care which specific actor comes next.
    const admin = await persistActor(actorRepo, { id: 'a3', role: 'ADMIN' });
    const batch = await supplyChain.createBatch(farmer, {
      productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg',
    });
    await supplyChain.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'x', assignNextTo: processor.id });
    await supplyChain.recordEvent(processor, { batchId: batch.id, stage: 'PROCESSING', location: 'x', assignNextTo: admin.id });

    const result = await traceService.trace(batch.id, 'forward');
    expect(result.events.map((e) => e.stage)).toEqual(['HARVEST', 'PROCESSING']);
    expect(result.isValid).toBe(true);
    expect(result.anomalies).toHaveLength(0);
  });

  it('traces backward in descending sequence order', async () => {
    const { supplyChain, traceService, actorRepo } = makeContext();
    const farmer = await persistActor(actorRepo, { role: 'FARMER' });
    const processor = await persistActor(actorRepo, { id: 'a2', role: 'PROCESSOR' });
    // ADMIN's role satisfies every stage, so it's a convenient assignNextTo
    // target for tests that don't care which specific actor comes next.
    const admin = await persistActor(actorRepo, { id: 'a3', role: 'ADMIN' });
    const batch = await supplyChain.createBatch(farmer, {
      productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg',
    });
    await supplyChain.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'x', assignNextTo: processor.id });
    await supplyChain.recordEvent(processor, { batchId: batch.id, stage: 'PROCESSING', location: 'x', assignNextTo: admin.id });

    const result = await traceService.trace(batch.id, 'backward');
    expect(result.events.map((e) => e.stage)).toEqual(['PROCESSING', 'HARVEST']);
  });

  it('flags the chain invalid once an event is tampered with', async () => {
    const { supplyChain, traceService, actorRepo } = makeContext();
    const farmer = await persistActor(actorRepo, { role: 'FARMER' });
    const processor = await persistActor(actorRepo, { role: 'PROCESSOR', id: 'a2' });
    const batch = await supplyChain.createBatch(farmer, {
      productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg',
    });
    const event = await supplyChain.recordEvent(farmer, {
      batchId: batch.id, stage: 'HARVEST', location: 'x', assignNextTo: processor.id,
    });

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
    const { supplyChain, traceService, actorRepo } = makeContext();
    const farmer = await persistActor(actorRepo, { role: 'FARMER' });
    const processor = await persistActor(actorRepo, { role: 'PROCESSOR', id: 'a2' });
    const batch = await supplyChain.createBatch(farmer, {
      productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg',
    });
    await supplyChain.recordEvent(farmer, {
      batchId: batch.id, stage: 'HARVEST', location: 'x', assignNextTo: processor.id,
    });

    const publicTrace = await traceService.publicTrace(batch.id);
    expect(publicTrace.stageCount).toBe(1);
    expect(publicTrace.isValid).toBe(true);
    expect((publicTrace.batch as Record<string, unknown>).createdBy).toBeUndefined();
  });
});
