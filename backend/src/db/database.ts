import { AsyncLocalStorage } from 'async_hooks';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

interface Scope {
  client: PoolClient;
  /** null = a transaction with no tenant context, so every RLS-protected table reads as empty. */
  tenantId: string | null;
}

/**
 * The single entry point every repository queries through.
 *
 * Unit of work: `withTenant(tenantId, fn)` opens ONE transaction, sets the
 * `app.tenant_id` setting that the row-level-security policies read (see
 * migration 009), and makes every `query()` issued anywhere inside `fn` —
 * across any number of repositories — run on that same connection. A
 * service method therefore gets atomicity (all writes commit or none do)
 * and tenant isolation enforced by Postgres itself, without threading a
 * client object through every call.
 *
 * Outside any scope, `query()` goes straight to the pool with no tenant set:
 * RLS-protected tables then return zero rows and reject writes. Forgetting
 * to scope a query fails closed, never open.
 */
export class Database {
  private readonly als = new AsyncLocalStorage<Scope>();

  constructor(readonly pool: Pool) {}

  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    const scope = this.als.getStore();
    return scope ? scope.client.query<T>(text, params) : this.pool.query<T>(text, params);
  }

  /** The tenant of the transaction currently in progress, if any. */
  currentTenantId(): string | null {
    return this.als.getStore()?.tenantId ?? null;
  }

  /**
   * Runs `fn` inside a transaction scoped to `tenantId`. Nested calls for the
   * same tenant join the outer transaction; switching tenant mid-transaction
   * is a programming error and throws.
   */
  withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const scope = this.als.getStore();
    if (scope) {
      if (scope.tenantId !== tenantId) {
        return Promise.reject(new Error('Cannot switch tenant inside an open transaction'));
      }
      return fn();
    }
    return this.runTransaction(tenantId, fn);
  }

  /** A transaction with no tenant context — for the few tenant-less tables (tenants) and SECURITY DEFINER lookups. */
  withoutTenant<T>(fn: () => Promise<T>): Promise<T> {
    const scope = this.als.getStore();
    if (scope) {
      if (scope.tenantId !== null) {
        return Promise.reject(new Error('Cannot leave tenant scope inside an open transaction'));
      }
      return fn();
    }
    return this.runTransaction(null, fn);
  }

  private async runTransaction<T>(tenantId: string | null, fn: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let released = false;
    try {
      await client.query('BEGIN');
      if (tenantId !== null) {
        // is_local = true → scoped to this transaction, so a pooled connection
        // can never leak one request's tenant into the next request.
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      }
      const result = await this.als.run({ client, tenantId }, fn);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The connection itself is broken — destroy it rather than return it to the pool.
        client.release(err as Error);
        released = true;
      }
      throw err;
    } finally {
      if (!released) client.release();
    }
  }

  /** Liveness probe for /health. */
  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Postgres SQLSTATE 23505, optionally narrowed to one constraint/index name. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && (constraint === undefined || e.constraint === constraint);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ids arrive straight from URLs (`/trace/public/:batchId`, QR codes). A
 * malformed one must read as "not found", not crash the query with
 * `invalid input syntax for type uuid` and surface as a 500.
 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
