import { join } from 'path';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { ActorRole, Tenant } from './domain/types';
import { loadSnapshot, SnapshotableRepos, startSnapshotting } from './persistence/snapshot';
import { InMemoryActorRepo } from './repository/memory/actorRepo';
import { InMemoryAnomalyRepo } from './repository/memory/anomalyRepo';
import { InMemoryAuditLogRepo } from './repository/memory/auditLogRepo';
import { InMemoryBatchRepo } from './repository/memory/batchRepo';
import { InMemoryEventRepo } from './repository/memory/eventRepo';
import { InMemoryRefreshTokenRepo } from './repository/memory/refreshTokenRepo';
import { InMemoryTenantRepo } from './repository/memory/tenantRepo';
import { PostgresActorRepo } from './repository/postgres/actorRepo';
import { PostgresAnomalyRepo } from './repository/postgres/anomalyRepo';
import { PostgresAuditLogRepo } from './repository/postgres/auditLogRepo';
import { PostgresBatchRepo } from './repository/postgres/batchRepo';
import { PostgresEventRepo } from './repository/postgres/eventRepo';
import { createPool } from './repository/postgres/pool';
import { PostgresRefreshTokenRepo } from './repository/postgres/refreshTokenRepo';
import { PostgresTenantRepo } from './repository/postgres/tenantRepo';
import {
  IActorRepo,
  IAnomalyRepo,
  IAuditLogRepo,
  IBatchRepo,
  IEventRepo,
  IRefreshTokenRepo,
  ITenantRepo,
} from './repository/interfaces';
import { SocketRealtimeEmitter } from './realtime';
import { seedSampleBatches } from './sampleData';
import { AdminService } from './services/adminService';
import { AuthService } from './services/authService';
import { StatsService } from './services/statsService';
import { SupplyChainService } from './services/supplyChainService';
import { TraceService } from './services/traceService';

export interface AppContext {
  tenantRepo: ITenantRepo;
  actorRepo: IActorRepo;
  batchRepo: IBatchRepo;
  eventRepo: IEventRepo;
  anomalyRepo: IAnomalyRepo;
  auditLogRepo: IAuditLogRepo;
  refreshTokenRepo: IRefreshTokenRepo;
  authService: AuthService;
  supplyChainService: SupplyChainService;
  traceService: TraceService;
  statsService: StatsService;
  adminService: AdminService;
  realtime: SocketRealtimeEmitter;
  usingPostgres: boolean;
}

/**
 * Every demo account joins this SAME pre-existing tenant (created before any
 * of them register) — pre-existing matters: AuthService.register makes the
 * first registrant of a genuinely NEW tenant its ADMIN regardless of chosen
 * role, which would silently turn farmer@demo.com into an admin if this
 * tenant didn't already exist by the time seeding runs.
 */
const DEMO_TENANT_SLUG = 'demo-tenant';

async function ensureDemoTenant(tenantRepo: ITenantRepo): Promise<Tenant> {
  const existing = await tenantRepo.findBySlug(DEMO_TENANT_SLUG);
  if (existing) return existing;
  return tenantRepo.create({ id: uuidv4(), slug: DEMO_TENANT_SLUG, name: 'TraceChain Demo', createdAt: new Date() });
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
    await authService.register(
      account.name,
      account.email,
      DEMO_PASSWORD,
      account.role,
      account.organization,
      DEMO_TENANT_SLUG,
    );
  }
}

/**
 * Demo accounts (including a well-known ADMIN login) must never appear in a
 * production deployment by accident — this only seeds when explicitly running
 * outside production, or when an operator has deliberately opted in for a
 * hosted demo via SEED_DEMO_DATA=true.
 */
function shouldSeedDemoAccounts(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO_DATA === 'true';
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Refusing to start with an insecure default — set it in your .env or deployment config.`,
    );
  }
  return value;
}

export async function bootstrap(): Promise<AppContext> {
  const jwtSecret = requireEnv('JWT_SECRET');
  const signingKey = requireEnv('LEDGER_SIGNING_KEY');
  const databaseUrl = process.env.DATABASE_URL;

  let tenantRepo: ITenantRepo;
  let actorRepo: IActorRepo;
  let batchRepo: IBatchRepo;
  let eventRepo: IEventRepo;
  let anomalyRepo: IAnomalyRepo;
  let auditLogRepo: IAuditLogRepo;
  let refreshTokenRepo: IRefreshTokenRepo;
  let pool: Pool | undefined;
  let usingPostgres = false;

  if (databaseUrl) {
    pool = createPool(databaseUrl);
    tenantRepo = new PostgresTenantRepo(pool);
    actorRepo = new PostgresActorRepo(pool);
    batchRepo = new PostgresBatchRepo(pool);
    eventRepo = new PostgresEventRepo(pool);
    anomalyRepo = new PostgresAnomalyRepo(pool);
    auditLogRepo = new PostgresAuditLogRepo(pool);
    refreshTokenRepo = new PostgresRefreshTokenRepo(pool);
    usingPostgres = true;
  } else {
    tenantRepo = new InMemoryTenantRepo();
    actorRepo = new InMemoryActorRepo();
    batchRepo = new InMemoryBatchRepo();
    eventRepo = new InMemoryEventRepo();
    anomalyRepo = new InMemoryAnomalyRepo();
    auditLogRepo = new InMemoryAuditLogRepo();
    refreshTokenRepo = new InMemoryRefreshTokenRepo();
  }

  // In-memory mode only: restore whatever was there before the last restart,
  // so the demo/small-deployment data survives a restart without needing
  // Postgres. If real data comes back, demo seeding below is skipped —
  // it would otherwise silently pile duplicate demo accounts/batches on top.
  let restoredFromSnapshot = false;
  const snapshotPath = process.env.SNAPSHOT_PATH ?? join(process.cwd(), '.data', 'snapshot.json');
  const inMemoryRepos = { tenantRepo, actorRepo, batchRepo, eventRepo, anomalyRepo, auditLogRepo } as unknown as SnapshotableRepos;
  if (!databaseUrl) {
    restoredFromSnapshot = loadSnapshot(inMemoryRepos, snapshotPath);
  }

  const realtime = new SocketRealtimeEmitter();
  const authService = new AuthService(actorRepo, refreshTokenRepo, auditLogRepo, tenantRepo, jwtSecret);
  const supplyChainService = new SupplyChainService(
    batchRepo,
    eventRepo,
    anomalyRepo,
    auditLogRepo,
    actorRepo,
    signingKey,
    pool,
    realtime,
  );
  const traceService = new TraceService(batchRepo, eventRepo, anomalyRepo, signingKey);
  const statsService = new StatsService(batchRepo, eventRepo, anomalyRepo);
  const adminService = new AdminService(actorRepo, eventRepo, batchRepo, anomalyRepo, auditLogRepo, signingKey);

  if (shouldSeedDemoAccounts() && !restoredFromSnapshot) {
    await ensureDemoTenant(tenantRepo);
    await seedDemoAccounts(authService, actorRepo);
    await seedSampleBatches(supplyChainService, actorRepo);
  }

  // Detect any tampering that happened while the server was down (or before
  // this scan existed) so it shows up in the anomaly/notification feeds
  // immediately rather than waiting for someone to open the Chain Verifier.
  await adminService.scanForTamperedChains();

  if (!databaseUrl) startSnapshotting(inMemoryRepos, snapshotPath);

  return {
    tenantRepo,
    actorRepo,
    batchRepo,
    eventRepo,
    anomalyRepo,
    auditLogRepo,
    refreshTokenRepo,
    authService,
    supplyChainService,
    traceService,
    statsService,
    adminService,
    realtime,
    usingPostgres,
  };
}
