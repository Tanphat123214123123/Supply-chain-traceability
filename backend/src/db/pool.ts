import { Pool, PoolConfig } from 'pg';

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return value;
}

/**
 * DATABASE_SSL=require   → TLS, certificate verified against system CAs
 * DATABASE_SSL=no-verify → TLS without verification (some managed providers' default certs)
 * unset                  → plain connection (local/docker only)
 */
export function sslConfigFromEnv(): PoolConfig['ssl'] {
  switch (process.env.DATABASE_SSL) {
    case undefined:
    case '':
    case 'disable':
      return undefined;
    case 'require':
      return { rejectUnauthorized: true };
    case 'no-verify':
      return { rejectUnauthorized: false };
    default:
      throw new Error(`DATABASE_SSL must be one of: require, no-verify, disable (got "${process.env.DATABASE_SSL}")`);
  }
}

export function createPool(databaseUrl: string, overrides: PoolConfig = {}): Pool {
  return new Pool({
    connectionString: databaseUrl,
    ssl: sslConfigFromEnv(),
    max: intFromEnv('DATABASE_POOL_MAX', 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: intFromEnv('DATABASE_CONNECT_TIMEOUT_MS', 5_000),
    // A runaway query must never pin a connection (and a batch row lock) forever.
    statement_timeout: intFromEnv('DATABASE_STATEMENT_TIMEOUT_MS', 15_000),
    idle_in_transaction_session_timeout: intFromEnv('DATABASE_IDLE_TX_TIMEOUT_MS', 30_000),
    application_name: 'tracechain-api',
    ...overrides,
  });
}
