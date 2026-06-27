import { InMemoryActorRepo, InMemoryBatchRepo, InMemoryEventRepo } from './repository/inMemory';
import { AnomalyDetector } from './services/anomalyDetector';
import { AuthService } from './services/authService';
import { SupplyChainService } from './services/supplyChainService';
import { ActorRole } from './domain/types';

export interface AppContext {
  authService: AuthService;
  supplyChainService: SupplyChainService;
}

export async function bootstrap(jwtSecret: string): Promise<AppContext> {
  const actorRepo = new InMemoryActorRepo();
  const batchRepo = new InMemoryBatchRepo();
  const eventRepo = new InMemoryEventRepo();
  const anomalyDetector = new AnomalyDetector();

  const authService = new AuthService(actorRepo, jwtSecret);
  const supplyChainService = new SupplyChainService(batchRepo, actorRepo, eventRepo, anomalyDetector);

  await Promise.all([
    authService.register('Alice Farmer',      'farmer@demo.com',      'demo1234', ActorRole.FARMER,      'Green Farm Co.'),
    authService.register('Bob Processor',     'processor@demo.com',   'demo1234', ActorRole.PROCESSOR,   'FoodTech Ltd.'),
    authService.register('Carol Inspector',   'inspector@demo.com',   'demo1234', ActorRole.INSPECTOR,   'QualityCheck Bureau'),
    authService.register('Dave Distributor',  'distributor@demo.com', 'demo1234', ActorRole.DISTRIBUTOR, 'LogiTrans Inc.'),
    authService.register('Eve Retailer',      'retailer@demo.com',    'demo1234', ActorRole.RETAILER,    'FreshMart'),
    authService.register('Frank Admin',       'admin@demo.com',       'demo1234', ActorRole.ADMIN,       'TraceChain HQ'),
  ]);

  console.log('[bootstrap] Seeded 6 demo actors (password: demo1234)');
  console.log('[bootstrap]   farmer@demo.com  processor@demo.com  inspector@demo.com');
  console.log('[bootstrap]   distributor@demo.com  retailer@demo.com  admin@demo.com');

  return { authService, supplyChainService };
}
