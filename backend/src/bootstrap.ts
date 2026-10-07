import { v4 as uuidv4 } from 'uuid';
import { Database } from './db/database';
import { assertSchemaUpToDate } from './db/migrator';
import { createPool } from './db/pool';
import { Actor, ActorRole } from './domain/types';
import { SocketRealtimeEmitter } from './realtime';
import { PostgresActorRepo } from './repository/postgres/actorRepo';
import { PostgresAnomalyRepo } from './repository/postgres/anomalyRepo';
import { PostgresAuditLogRepo } from './repository/postgres/auditLogRepo';
import { PostgresBatchRepo } from './repository/postgres/batchRepo';
import { PostgresEventRepo } from './repository/postgres/eventRepo';
import { PostgresRefreshTokenRepo } from './repository/postgres/refreshTokenRepo';
import { PostgresStatsRepo } from './repository/postgres/statsRepo';
import { PostgresTenantRepo } from './repository/postgres/tenantRepo';
import { seedSampleBatches } from './sampleData';
import { AdminService } from './services/adminService';
import { AuthOptions, AuthService } from './services/authService';
import { StatsService } from './services/statsService';
import { SupplyChainService } from './services/supplyChainService';
import { TraceService } from './services/traceService';

export interface AppConfig {
  jwtSecret: string;
  /** Former LEDGER_SIGNING_KEY — now only used to re-verify legacy v1 (HMAC) events. */
  legacyLedgerKey?: string;
  auth?: AuthOptions;
}

export interface AppContext {
  db: Database;
  authService: AuthService;
  supplyChainService: SupplyChainService;
  traceService: TraceService;
  statsService: StatsService;
  adminService: AdminService;
  realtime: SocketRealtimeEmitter;
}

/** Wires repositories and services around one Database — shared by the server and the test suite. */
export function createContext(db: Database, config: AppConfig): AppContext {
  const tenantRepo = new PostgresTenantRepo(db);
  const actorRepo = new PostgresActorRepo(db);
  const batchRepo = new PostgresBatchRepo(db);
  const eventRepo = new PostgresEventRepo(db);
  const anomalyRepo = new PostgresAnomalyRepo(db);
  const auditLogRepo = new PostgresAuditLogRepo(db);
  const refreshTokenRepo = new PostgresRefreshTokenRepo(db);
  const statsRepo = new PostgresStatsRepo(db);

  const realtime = new SocketRealtimeEmitter();

  return {
    db,
    realtime,
    authService: new AuthService(
      db,
      { actorRepo, refreshTokenRepo, auditLogRepo, tenantRepo },
      config.jwtSecret,
      config.auth,
    ),
    supplyChainService: new SupplyChainService(db, { batchRepo, eventRepo, anomalyRepo, auditLogRepo, actorRepo }, realtime),
    traceService: new TraceService(db, { batchRepo, eventRepo, anomalyRepo }, config.legacyLedgerKey),
    statsService: new StatsService(db, statsRepo),
    adminService: new AdminService(
      db,
      { tenantRepo, actorRepo, eventRepo, batchRepo, anomalyRepo, auditLogRepo },
      config.legacyLedgerKey,
    ),
  };
}

// ── Demo data ───────────────────────────────────────────────────────────────

/**
 * Every demo account joins this SAME pre-existing tenant (created before any
 * of them register) — pre-existing matters: AuthService.register makes the
 * first registrant of a genuinely NEW tenant its ADMIN regardless of chosen
 * role, which would silently turn farmer@demo.com into an admin otherwise.
 */
const DEMO_TENANT_SLUG = 'demo-tenant';

const DEMO_ACCOUNTS: Array<{ name: string; email: string; role: ActorRole; organization: string }> = [
  { name: 'Nguyễn Văn Nông', email: 'farmer@demo.com', role: 'FARMER', organization: 'Nông trại Đà Lạt' },
  { name: 'Trần Thị Chế Biến', email: 'processor@demo.com', role: 'PROCESSOR', organization: 'Xưởng chế biến An Giang' },
  { name: 'Lê Văn Kiểm Định', email: 'inspector@demo.com', role: 'INSPECTOR', organization: 'Trung tâm kiểm định VN' },
  { name: 'Phạm Thị Phân Phối', email: 'distributor@demo.com', role: 'DISTRIBUTOR', organization: 'Công ty logistics ABC' },
  { name: 'Hoàng Văn Bán Lẻ', email: 'retailer@demo.com', role: 'RETAILER', organization: 'Siêu thị XYZ' },
  { name: 'Admin Hệ Thống', email: 'admin@demo.com', role: 'ADMIN', organization: 'TraceChain' },
];

const DEMO_PASSWORD = 'demo1234';

/** Idempotent: safe on every boot — existing tenant, accounts and batches are left untouched. */
export async function seedDemoData(ctx: AppContext): Promise<void> {
  const tenantRepo = new PostgresTenantRepo(ctx.db);
  const actorRepo = new PostgresActorRepo(ctx.db);

  let tenant = await tenantRepo.findBySlug(DEMO_TENANT_SLUG);
  if (!tenant) {
    await tenantRepo.insertIfAbsent({ id: uuidv4(), slug: DEMO_TENANT_SLUG, name: 'TraceChain Demo', createdAt: new Date() });
    tenant = await tenantRepo.findBySlug(DEMO_TENANT_SLUG);
  }
  if (!tenant) throw new Error('Could not create the demo tenant');

  for (const account of DEMO_ACCOUNTS) {
    if (await actorRepo.lookupByEmail(account.email)) continue;
    await ctx.authService.register(
      account.name,
      account.email,
      DEMO_PASSWORD,
      account.role,
      account.organization,
      DEMO_TENANT_SLUG,
    );
  }

  const demoTenantId = tenant.id;
  const findActorByEmail = async (email: string): Promise<Actor | null> => {
    const identity = await actorRepo.lookupByEmail(email);
    if (!identity || identity.tenantId !== demoTenantId) return null;
    return ctx.db.withTenant(demoTenantId, () => actorRepo.findById(identity.actorId));
  };
  await seedSampleBatches(ctx.supplyChainService, demoTenantId, findActorByEmail);
}

/**
 * Demo accounts (including a well-known ADMIN login) must never appear in a
 * production deployment by accident — this only seeds when explicitly running
 * outside production, or when an operator has deliberately opted in for a
 * hosted demo via SEED_DEMO_DATA=true.
 */
function shouldSeedDemoData(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO_DATA === 'true';
}

// ── Startup ─────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Refusing to start with an insecure default — set it in your .env or deployment config.`,
    );
  }
  return value;
}

/**
 * Row-level security and the append-only/column grants only bind a role that
 * is neither superuser, BYPASSRLS, nor the owner of the tables. Running the
 * API as such a role silently turns those protections off — refuse to do so
 * in production; warn loudly anywhere else.
 */
async function checkConnectionRole(db: Database): Promise<void> {
  const result = await db.query<{ role: string; superuser: boolean; bypass_rls: boolean; owns_ledger: boolean }>(
    `SELECT r.rolname AS role,
            r.rolsuper AS superuser,
            r.rolbypassrls AS bypass_rls,
            pg_has_role(current_user, c.relowner, 'USAGE') AS owns_ledger
       FROM pg_roles r, pg_class c
      WHERE r.rolname = current_user
        AND c.oid = 'public.trace_events'::regclass`,
  );
  const row = result.rows[0];
  const problems = [
    row.superuser && 'is a superuser',
    row.bypass_rls && 'has BYPASSRLS',
    row.owns_ledger && 'owns the schema tables',
  ].filter(Boolean);
  if (problems.length === 0) return;

  const message =
    `Database role "${row.role}" ${problems.join(', ')} — row-level security and ledger grants do NOT apply to it. ` +
    'Connect the API as the least-privilege role "tracechain_app" (see docs/DATABASE.md).';
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRIVILEGED_DB_ROLE !== 'true') {
    throw new Error(message);
  }
  console.warn(`⚠️  ${message}`);
}

export async function bootstrap(): Promise<AppContext> {
  const jwtSecret = requireEnv('JWT_SECRET');
  const databaseUrl = requireEnv('DATABASE_URL');

  const db = new Database(createPool(databaseUrl));
  try {
    await assertSchemaUpToDate(db);
    await checkConnectionRole(db);

    const ctx = createContext(db, { jwtSecret, legacyLedgerKey: process.env.LEDGER_SIGNING_KEY || undefined });
    if (shouldSeedDemoData()) await seedDemoData(ctx);
    return ctx;
  } catch (err) {
    await db.close();
    throw err;
  }
}
