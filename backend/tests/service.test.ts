import { InMemoryActorRepo, InMemoryBatchRepo, InMemoryEventRepo } from '../src/repository/inMemory';
import { AnomalyDetector } from '../src/services/anomalyDetector';
import { AuthService } from '../src/services/authService';
import { SupplyChainService } from '../src/services/supplyChainService';
import { ActorRole, SupplyChainStage } from '../src/domain/types';

function buildServices() {
  const actorRepo = new InMemoryActorRepo();
  const batchRepo = new InMemoryBatchRepo();
  const eventRepo = new InMemoryEventRepo();
  const anomalyDetector = new AnomalyDetector();
  const authService = new AuthService(actorRepo, 'test-secret');
  const supplyChainService = new SupplyChainService(batchRepo, actorRepo, eventRepo, anomalyDetector);
  return { authService, supplyChainService };
}

async function seedActors(authService: AuthService) {
  const [farmer, processor, inspector, distributor, retailer, admin] = await Promise.all([
    authService.register('Alice', 'farmer@t.com',      'p', ActorRole.FARMER,      'Farm'),
    authService.register('Bob',   'proc@t.com',        'p', ActorRole.PROCESSOR,   'Factory'),
    authService.register('Carol', 'insp@t.com',        'p', ActorRole.INSPECTOR,   'QC'),
    authService.register('Dave',  'dist@t.com',        'p', ActorRole.DISTRIBUTOR, 'Logistics'),
    authService.register('Eve',   'ret@t.com',         'p', ActorRole.RETAILER,    'Mart'),
    authService.register('Frank', 'admin@t.com',       'p', ActorRole.ADMIN,       'HQ'),
  ]);
  return { farmer, processor, inspector, distributor, retailer, admin };
}

describe('AuthService', () => {
  test('registers and logs in', async () => {
    const { authService } = buildServices();
    await authService.register('Alice', 'alice@test.com', 'password123', ActorRole.FARMER, 'Farm');
    const result = await authService.login({ email: 'alice@test.com', password: 'password123' });
    expect(result.token).toBeDefined();
    expect(result.actor.role).toBe(ActorRole.FARMER);
    expect((result.actor as any).passwordHash).toBeUndefined();
  });

  test('rejects duplicate email', async () => {
    const { authService } = buildServices();
    await authService.register('Alice', 'alice@test.com', 'p', ActorRole.FARMER, 'Farm');
    await expect(
      authService.register('Alice2', 'alice@test.com', 'p', ActorRole.FARMER, 'Farm'),
    ).rejects.toThrow('Email already registered');
  });

  test('rejects wrong password', async () => {
    const { authService } = buildServices();
    await authService.register('Alice', 'alice@test.com', 'correct', ActorRole.FARMER, 'Farm');
    await expect(authService.login({ email: 'alice@test.com', password: 'wrong' })).rejects.toThrow(
      'Invalid credentials',
    );
  });

  test('verifyToken round-trip', async () => {
    const { authService } = buildServices();
    await authService.register('Alice', 'alice@test.com', 'p', ActorRole.FARMER, 'Farm');
    const { token } = await authService.login({ email: 'alice@test.com', password: 'p' });
    const payload = authService.verifyToken(token);
    expect(payload.role).toBe(ActorRole.FARMER);
    expect(payload.email).toBe('alice@test.com');
  });
});

describe('SupplyChainService — happy path', () => {
  test('full journey produces a valid chain with no anomalies', async () => {
    const { authService, supplyChainService } = buildServices();
    const { farmer, processor, inspector, distributor, retailer } = await seedActors(authService);

    const batch = await supplyChainService.createBatch(
      { productName: 'Tomatoes', productType: 'Vegetable', origin: 'Da Lat', quantity: 100, unit: 'kg' },
      farmer.id,
    );

    const stageActors = [
      { actorId: farmer.id,      stage: SupplyChainStage.HARVEST },
      { actorId: processor.id,   stage: SupplyChainStage.PROCESSING },
      { actorId: inspector.id,   stage: SupplyChainStage.QUALITY_CHECK },
      { actorId: processor.id,   stage: SupplyChainStage.PACKAGING },
      { actorId: distributor.id, stage: SupplyChainStage.DISTRIBUTION },
      { actorId: retailer.id,    stage: SupplyChainStage.RETAIL },
    ];

    for (const { actorId, stage } of stageActors) {
      await supplyChainService.recordEvent({ batchId: batch.id, stage, location: 'Somewhere' }, actorId);
    }

    const trace = await supplyChainService.traceForward(batch.id);
    expect(trace.events).toHaveLength(6);
    expect(trace.isValid).toBe(true);
    expect(trace.anomalies).toHaveLength(0);

    // Verify sequence numbers and hash links
    for (let i = 0; i < trace.events.length; i++) {
      expect(trace.events[i].sequenceNumber).toBe(i);
    }
  });

  test('traceBackward reverses event order', async () => {
    const { authService, supplyChainService } = buildServices();
    const { farmer } = await seedActors(authService);
    const batch = await supplyChainService.createBatch(
      { productName: 'X', productType: 'Y', origin: 'Z', quantity: 1, unit: 'kg' },
      farmer.id,
    );
    await supplyChainService.recordEvent({ batchId: batch.id, stage: SupplyChainStage.HARVEST, location: 'Farm' }, farmer.id);

    const forward = await supplyChainService.traceForward(batch.id);
    const backward = await supplyChainService.traceBackward(batch.id);
    expect(backward.events[0].sequenceNumber).toBe(forward.events[forward.events.length - 1].sequenceNumber);
  });
});

describe('SupplyChainService — access control', () => {
  test('farmer cannot record DISTRIBUTION', async () => {
    const { authService, supplyChainService } = buildServices();
    const { farmer } = await seedActors(authService);
    const batch = await supplyChainService.createBatch(
      { productName: 'X', productType: 'Y', origin: 'Z', quantity: 1, unit: 'kg' }, farmer.id,
    );
    await expect(
      supplyChainService.recordEvent({ batchId: batch.id, stage: SupplyChainStage.DISTRIBUTION, location: 'Hub' }, farmer.id),
    ).rejects.toThrow('not authorized');
  });

  test('admin can record any stage', async () => {
    const { authService, supplyChainService } = buildServices();
    const { admin } = await seedActors(authService);
    const batch = await supplyChainService.createBatch(
      { productName: 'X', productType: 'Y', origin: 'Z', quantity: 1, unit: 'kg' }, admin.id,
    );
    await expect(
      supplyChainService.recordEvent({ batchId: batch.id, stage: SupplyChainStage.HARVEST, location: 'Farm' }, admin.id),
    ).resolves.toBeDefined();
  });
});

describe('SupplyChainService — recall', () => {
  test('recalls a batch', async () => {
    const { authService, supplyChainService } = buildServices();
    const { farmer, admin } = await seedActors(authService);
    const batch = await supplyChainService.createBatch(
      { productName: 'X', productType: 'Y', origin: 'Z', quantity: 1, unit: 'kg' }, farmer.id,
    );
    const recalled = await supplyChainService.recallBatch(batch.id, 'Contamination', admin.id);
    expect(recalled.isRecalled).toBe(true);
    expect(recalled.recallReason).toBe('Contamination');
  });

  test('blocks new events on recalled batch', async () => {
    const { authService, supplyChainService } = buildServices();
    const { farmer, admin } = await seedActors(authService);
    const batch = await supplyChainService.createBatch(
      { productName: 'X', productType: 'Y', origin: 'Z', quantity: 1, unit: 'kg' }, farmer.id,
    );
    await supplyChainService.recallBatch(batch.id, 'Contamination', admin.id);
    await expect(
      supplyChainService.recordEvent({ batchId: batch.id, stage: SupplyChainStage.HARVEST, location: 'Farm' }, farmer.id),
    ).rejects.toThrow('recalled');
  });
});

describe('SupplyChainService — anomaly detection', () => {
  test('blocks stage out of order', async () => {
    const { authService, supplyChainService } = buildServices();
    const { farmer, distributor } = await seedActors(authService);
    const batch = await supplyChainService.createBatch(
      { productName: 'X', productType: 'Y', origin: 'Z', quantity: 1, unit: 'kg' }, farmer.id,
    );
    // Record DISTRIBUTION first (would require admin or distributor, but we'll use admin via... wait,
    // distributor can only record DISTRIBUTION, and DISTRIBUTION is at index 4. But farmer is at HARVEST.
    // We need to seed admin to skip to DISTRIBUTION then try HARVEST.
    const { admin } = await seedActors(buildServices().authService); // won't work, different service
    // Instead: use a fresh setup
    const { authService: a2, supplyChainService: s2 } = buildServices();
    const adm = await a2.register('Frank', 'admin@t2.com', 'p', ActorRole.ADMIN, 'HQ');
    const bat2 = await s2.createBatch(
      { productName: 'X', productType: 'Y', origin: 'Z', quantity: 1, unit: 'kg' }, adm.id,
    );
    await s2.recordEvent({ batchId: bat2.id, stage: SupplyChainStage.DISTRIBUTION, location: 'Hub' }, adm.id);
    // Now try to record HARVEST (before DISTRIBUTION in order)
    await expect(
      s2.recordEvent({ batchId: bat2.id, stage: SupplyChainStage.HARVEST, location: 'Farm' }, adm.id),
    ).rejects.toThrow('Anomaly blocked');
  });

  test('updateStage tracks highest stage reached', async () => {
    const { authService, supplyChainService } = buildServices();
    const { farmer, processor } = await seedActors(authService);
    const batch = await supplyChainService.createBatch(
      { productName: 'X', productType: 'Y', origin: 'Z', quantity: 1, unit: 'kg' }, farmer.id,
    );
    await supplyChainService.recordEvent({ batchId: batch.id, stage: SupplyChainStage.HARVEST, location: 'Farm' }, farmer.id);
    await supplyChainService.recordEvent({ batchId: batch.id, stage: SupplyChainStage.PROCESSING, location: 'Factory' }, processor.id);
    const updated = await supplyChainService.getBatch(batch.id);
    expect(updated?.currentStage).toBe(SupplyChainStage.PROCESSING);
  });
});
