import { ActorRole } from './domain/types';
import { InMemoryActorRepo } from './repository/memory/actorRepo';
import { InMemoryBatchRepo } from './repository/memory/batchRepo';
import { InMemoryEventRepo } from './repository/memory/eventRepo';
import { PostgresActorRepo } from './repository/postgres/actorRepo';
import { PostgresBatchRepo } from './repository/postgres/batchRepo';
import { PostgresEventRepo } from './repository/postgres/eventRepo';
import { createPool } from './repository/postgres/pool';
import { IActorRepo, IBatchRepo, IEventRepo } from './repository/interfaces';
import { AuthService } from './services/authService';
import { StatsService } from './services/statsService';
import { SupplyChainService } from './services/supplyChainService';
import { TraceService } from './services/traceService';

export interface AppContext {
  actorRepo: IActorRepo;
  batchRepo: IBatchRepo;
  eventRepo: IEventRepo;
  authService: AuthService;
  supplyChainService: SupplyChainService;
  traceService: TraceService;
  statsService: StatsService;
  usingPostgres: boolean;
}

const DEMO_ACCOUNTS: Array<{ name: string; email: string; role: ActorRole; organization: string }> = [
  { name: 'Nguyễn Văn Nông', email: 'farmer@demo.com', role: 'FARMER', organization: 'Nông trại Đà Lạt' },
  { name: 'Trần Thị Chế Biến', email: 'processor@demo.com', role: 'PROCESSOR', organization: 'Xưởng chế biến An Giang' },
  { name: 'Lê Văn Kiểm Định', email: 'inspector@demo.com', role: 'INSPECTOR', organization: 'Trung tâm kiểm định VN' },
  { name: 'Phạm Thị Phân Phối', email: 'distributor@demo.com', role: 'DISTRIBUTOR', organization: 'Công ty logistics ABC' },
  { name: 'Hoàng Văn Bán Lẻ', email: 'retailer@demo.com', role: 'RETAILER', organization: 'Siêu thị XYZ' },
  { name: 'Admin Hệ Thống', email: 'admin@demo.com', role: 'ADMIN', organization: 'TraceChain' },
];

const DEMO_PASSWORD = 'demo1234';

async function seedDemoAccounts(authService: AuthService, actorRepo: IActorRepo): Promise<void> {
  for (const account of DEMO_ACCOUNTS) {
    const existing = await actorRepo.findByEmail(account.email);
    if (existing) continue;
    await authService.register(account.name, account.email, DEMO_PASSWORD, account.role, account.organization);
  }
}

export async function bootstrap(): Promise<AppContext> {
  const jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-change-me';
  const databaseUrl = process.env.DATABASE_URL;

  let actorRepo: IActorRepo;
  let batchRepo: IBatchRepo;
  let eventRepo: IEventRepo;
  let usingPostgres = false;

  if (databaseUrl) {
    const pool = createPool(databaseUrl);
    actorRepo = new PostgresActorRepo(pool);
    batchRepo = new PostgresBatchRepo(pool);
    eventRepo = new PostgresEventRepo(pool);
    usingPostgres = true;
  } else {
    actorRepo = new InMemoryActorRepo();
    batchRepo = new InMemoryBatchRepo();
    eventRepo = new InMemoryEventRepo();
  }

  const authService = new AuthService(actorRepo, jwtSecret);
  const supplyChainService = new SupplyChainService(batchRepo, eventRepo);
  const traceService = new TraceService(batchRepo, eventRepo);
  const statsService = new StatsService(batchRepo, eventRepo);

  await seedDemoAccounts(authService, actorRepo);

  return { actorRepo, batchRepo, eventRepo, authService, supplyChainService, traceService, statsService, usingPostgres };
}
