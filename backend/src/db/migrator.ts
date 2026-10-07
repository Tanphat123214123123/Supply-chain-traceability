import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Pool, QueryResult, QueryResultRow } from 'pg';

/** `<root>/migrations` — same relative depth from both `src/db` (ts-node) and `dist/db` (compiled). */
export const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

// Arbitrary but fixed: every process that migrates this database contends for
// the same advisory lock, so two replicas booting at once can't interleave.
const MIGRATION_LOCK_KEY = 72_410_001;

const FILE_PATTERN = /^(\d{3,})_[a-z0-9_]+\.sql$/;

export interface MigrationFile {
  version: number;
  name: string;
  checksum: string;
  sql: string;
}

export interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
}

export function loadMigrationFiles(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const seen = new Set<number>();
  return files.map((name) => {
    const match = FILE_PATTERN.exec(name);
    if (!match) throw new Error(`Migration file "${name}" must be named like 012_short_description.sql`);
    const version = Number(match[1]);
    if (seen.has(version)) throw new Error(`Duplicate migration version ${version} (${name})`);
    seen.add(version);
    // Line endings are normalised before hashing so a Windows checkout with
    // CRLF doesn't register as "someone edited an applied migration".
    const sql = readFileSync(join(dir, name), 'utf-8').replace(/\r\n/g, '\n');
    return { version, name, checksum: createHash('sha256').update(sql).digest('hex'), sql };
  });
}

/** Anything that can run a parameterised query: a pg client, a pool, or the app's Database. */
interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

async function ensureMigrationsTable(db: Queryable): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      checksum    CHAR(64) NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

async function readApplied(db: Queryable): Promise<AppliedMigration[]> {
  const result = await db.query<AppliedMigration>(
    'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
  );
  return result.rows;
}

/**
 * Applied migrations are immutable history: editing one after it has run
 * means production and a fresh database would silently diverge. Fail loudly
 * instead, and require a new migration for any change.
 */
function assertNoDrift(files: MigrationFile[], applied: AppliedMigration[]): void {
  const byVersion = new Map(files.map((f) => [f.version, f]));
  for (const row of applied) {
    const file = byVersion.get(row.version);
    if (!file) {
      throw new Error(
        `Database has migration ${row.version} (${row.name}) which no longer exists on disk — refusing to continue.`,
      );
    }
    if (file.checksum !== row.checksum.trim()) {
      throw new Error(
        `Migration ${file.name} was modified after being applied (checksum mismatch). Add a new migration instead of editing an applied one.`,
      );
    }
  }
}

export interface MigrateResult {
  applied: string[];
  alreadyApplied: number;
}

/**
 * Applies every pending migration, each inside its own transaction, while
 * holding a session-level advisory lock. Must run with a role that owns the
 * schema (DDL, CREATE ROLE, GRANT) — never with the application's runtime role.
 */
export async function migrate(
  pool: Pool,
  options: { dir?: string; log?: (msg: string) => void; /** Stop after this version (tests of upgrade paths). */ targetVersion?: number } = {},
): Promise<MigrateResult> {
  const log = options.log ?? (() => {});
  const files = loadMigrationFiles(options.dir);
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await ensureMigrationsTable(client);
      const applied = await readApplied(client);
      assertNoDrift(files, applied);

      const appliedVersions = new Set(applied.map((a) => a.version));
      const pending = files.filter(
        (f) => !appliedVersions.has(f.version) && (options.targetVersion === undefined || f.version <= options.targetVersion),
      );
      const done: string[] = [];

      for (const file of pending) {
        log(`→ applying ${file.name}`);
        await client.query('BEGIN');
        try {
          await client.query(file.sql);
          await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
            file.version,
            file.name,
            file.checksum,
          ]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`Migration ${file.name} failed: ${(err as Error).message}`);
        }
        done.push(file.name);
      }

      return { applied: done, alreadyApplied: applied.length };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

/**
 * Read-only check the application runs at startup (with its own, non-DDL
 * role): refuses to serve traffic against a schema that's behind — or ahead
 * of / diverged from — the code that's about to use it.
 */
export async function assertSchemaUpToDate(db: Queryable, dir?: string): Promise<void> {
  const files = loadMigrationFiles(dir);
  let applied: AppliedMigration[];
  try {
    applied = await readApplied(db);
  } catch (err) {
    if ((err as { code?: string }).code === '42P01') {
      throw new Error('Database schema is not initialised — run `npm run migrate` first.');
    }
    throw err;
  }
  assertNoDrift(files, applied);
  const appliedVersions = new Set(applied.map((a) => a.version));
  const pending = files.filter((f) => !appliedVersions.has(f.version));
  if (pending.length > 0) {
    throw new Error(
      `Database schema is behind the code — pending migrations: ${pending.map((p) => p.name).join(', ')}. Run \`npm run migrate\`.`,
    );
  }
}
