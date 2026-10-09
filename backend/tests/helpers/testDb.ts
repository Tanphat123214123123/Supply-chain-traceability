import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { AppContext, createContext } from '../../src/bootstrap';
import { Database } from '../../src/db/database';
import { APP_DB_ROLE } from '../../src/db/roles';
import { Actor, ActorRole, Tenant } from '../../src/domain/types';
import { PostgresActorRepo } from '../../src/repository/postgres/actorRepo';
import { PostgresTenantRepo } from '../../src/repository/postgres/tenantRepo';
import { APP_ROLE_TEST_PASSWORD, withDatabase, workerDatabaseName } from '../setup/pgUrls';

export const TEST_JWT_SECRET = 'test-jwt-secret';
export const TEST_LEGACY_KEY = 'test-legacy-ledger-key';

export interface TestDb {
  /** The application's Database, connected as the least-privilege `tracechain_app` role. */
  db: Database;
  /** Superuser pool for test setup and for simulating attacks that bypass the app (tampering). */
  ownerPool: Pool;
  ctx: AppContext;
}

const ALL_TABLES =
  'tenants, invitations, actors, plots, batches, trace_events, transformations, transformation_inputs, transformation_outputs, anchors, anchor_leaves, anomalies, audit_logs, refresh_tokens';

/**
 * Registers beforeAll/beforeEach/afterAll hooks for a test file and returns
 * an accessor. Every test starts from empty tables in this worker's own
 * database (see setup/globalSetup.ts).
 */
export function useTestDatabase(options: { legacyKey?: string } = {}): () => TestDb {
  let current: TestDb | undefined;

  beforeAll(() => {
    const adminUrl = process.env.TEST_PG_ADMIN_URL;
    if (!adminUrl) throw new Error('TEST_PG_ADMIN_URL missing — tests must run through jest globalSetup');
    const database = workerDatabaseName(process.env.JEST_WORKER_ID ?? '1');

    const ownerPool = new Pool({ connectionString: withDatabase(adminUrl, database), max: 2 });
    const appPool = new Pool({
      connectionString: withDatabase(adminUrl, database, { user: APP_DB_ROLE, password: APP_ROLE_TEST_PASSWORD }),
      max: 10,
    });
    const db = new Database(appPool);
    const ctx = createContext(db, {
      jwtSecret: TEST_JWT_SECRET,
      legacyLedgerKey: options.legacyKey ?? TEST_LEGACY_KEY,
      auth: { bcryptCost: 4, accessTokenTtlSeconds: 3600 },
    });
    current = { db, ownerPool, ctx };
  });

  beforeEach(async () => {
    // replica mode skips (non-ALWAYS) triggers, so the append-only TRUNCATE
    // guard on the ledger tables doesn't stop the per-test reset.
    const client = await current!.ownerPool.connect();
    try {
      await client.query('SET session_replication_role = replica');
      await client.query(`TRUNCATE ${ALL_TABLES} CASCADE`);
    } finally {
      await client.query('RESET session_replication_role');
      client.release();
    }
  });

  afterAll(async () => {
    await current?.db.close();
    await current?.ownerPool.end();
  });

  return () => {
    if (!current) throw new Error('useTestDatabase() accessor called outside a test');
    return current;
  };
}

// ── Fixtures ────────────────────────────────────────────────────────────────

export async function createTenant(t: TestDb, slug = `t-${uuidv4().slice(0, 8)}`): Promise<Tenant> {
  const tenant = { id: uuidv4(), slug, name: `Tenant ${slug}`, createdAt: new Date() };
  const created = await new PostgresTenantRepo(t.db).insertIfAbsent(tenant);
  if (!created) throw new Error(`tenant slug ${slug} already exists`);
  return created;
}

/** Inserts an actor directly (no bcrypt) through the app role — for tests that don't exercise login. */
export async function createActor(t: TestDb, tenant: Tenant, role: ActorRole, overrides: Partial<Actor> = {}): Promise<Actor> {
  const id = overrides.id ?? uuidv4();
  const actor: Actor = {
    id,
    name: `${role} ${id.slice(0, 4)}`,
    email: `${role.toLowerCase()}-${id}@test.local`,
    passwordHash: 'not-a-real-hash',
    role,
    organization: `${role} Org`,
    tenantId: tenant.id,
    createdAt: new Date(),
    isActive: true,
    ...overrides,
  };
  await t.db.withTenant(tenant.id, () => new PostgresActorRepo(t.db).create(actor));
  return actor;
}

/** Runs SQL as the superuser with triggers disabled — the "attacker with direct DB access" for tamper tests. */
export async function asAttacker(t: TestDb, sql: string, params: unknown[] = []): Promise<void> {
  const client = await t.ownerPool.connect();
  try {
    await client.query('SET session_replication_role = replica');
    await client.query(sql, params);
  } finally {
    await client.query('RESET session_replication_role');
    client.release();
  }
}

export const sampleBatch = {
  productName: 'Cà phê Robusta',
  productType: 'Nông sản',
  origin: 'Buôn Ma Thuột, Đắk Lắk',
  quantity: 1000,
  unit: 'kg',
};
