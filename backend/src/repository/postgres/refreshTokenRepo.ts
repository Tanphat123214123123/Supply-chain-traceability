import { Database } from '../../db/database';
import { RefreshTokenRecord } from '../../domain/types';
import { ActorIdentity, IRefreshTokenRepo } from '../interfaces';

interface RefreshTokenRow {
  token: string;
  actor_id: string;
  tenant_id: string;
  expires_at: Date;
  revoked: boolean;
  created_at: Date;
}

function toRecord(row: RefreshTokenRow): RefreshTokenRecord {
  return {
    token: row.token,
    actorId: row.actor_id,
    tenantId: row.tenant_id,
    expiresAt: row.expires_at,
    revoked: row.revoked,
    createdAt: row.created_at,
  };
}

export class PostgresRefreshTokenRepo implements IRefreshTokenRepo {
  constructor(private readonly db: Database) {}

  async create(record: RefreshTokenRecord): Promise<RefreshTokenRecord> {
    await this.db.query(
      `INSERT INTO refresh_tokens (token, actor_id, tenant_id, expires_at, revoked, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [record.token, record.actorId, record.tenantId, record.expiresAt, record.revoked, record.createdAt],
    );
    return record;
  }

  async consume(tokenHash: string): Promise<ActorIdentity | null> {
    const result = await this.db.query<{ actor_id: string; tenant_id: string }>(
      'SELECT actor_id, tenant_id FROM auth_consume_refresh_token($1)',
      [tokenHash],
    );
    const row = result.rows[0];
    return row ? { actorId: row.actor_id, tenantId: row.tenant_id } : null;
  }

  async revoke(tokenHash: string): Promise<void> {
    await this.db.query('SELECT auth_revoke_refresh_token($1)', [tokenHash]);
  }

  async findActiveByActorId(actorId: string): Promise<RefreshTokenRecord[]> {
    const result = await this.db.query<RefreshTokenRow>(
      `SELECT token, actor_id, tenant_id, expires_at, revoked, created_at
         FROM refresh_tokens
        WHERE actor_id = $1 AND NOT revoked AND expires_at > now()
        ORDER BY created_at DESC`,
      [actorId],
    );
    return result.rows.map(toRecord);
  }

  async revokeForActor(actorId: string, tokenHash: string): Promise<boolean> {
    const result = await this.db.query(
      'UPDATE refresh_tokens SET revoked = true WHERE actor_id = $1 AND token = $2 AND NOT revoked',
      [actorId, tokenHash],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async purgeStale(): Promise<number> {
    const result = await this.db.query<{ removed: number }>('SELECT purge_stale_refresh_tokens() AS removed');
    return result.rows[0].removed;
  }
}
