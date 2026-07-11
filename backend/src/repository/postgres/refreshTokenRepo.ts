import { Pool } from 'pg';
import { RefreshTokenRecord } from '../../domain/types';
import { IRefreshTokenRepo } from '../interfaces';

interface RefreshTokenRow {
  token: string;
  actor_id: string;
  expires_at: Date;
  revoked: boolean;
  created_at: Date;
}

function toRecord(row: RefreshTokenRow): RefreshTokenRecord {
  return {
    token: row.token,
    actorId: row.actor_id,
    expiresAt: row.expires_at,
    revoked: row.revoked,
    createdAt: row.created_at,
  };
}

export class PostgresRefreshTokenRepo implements IRefreshTokenRepo {
  constructor(private readonly pool: Pool) {}

  async create(record: RefreshTokenRecord): Promise<RefreshTokenRecord> {
    await this.pool.query(
      `INSERT INTO refresh_tokens (token, actor_id, expires_at, revoked, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [record.token, record.actorId, record.expiresAt, record.revoked, record.createdAt],
    );
    return record;
  }

  async findByToken(token: string): Promise<RefreshTokenRecord | null> {
    const result = await this.pool.query<RefreshTokenRow>('SELECT * FROM refresh_tokens WHERE token = $1', [token]);
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async findActiveByActorId(actorId: string): Promise<RefreshTokenRecord[]> {
    const result = await this.pool.query<RefreshTokenRow>(
      `SELECT * FROM refresh_tokens WHERE actor_id = $1 AND revoked = false AND expires_at > now() ORDER BY created_at DESC`,
      [actorId],
    );
    return result.rows.map(toRecord);
  }

  async revoke(token: string): Promise<void> {
    await this.pool.query('UPDATE refresh_tokens SET revoked = true WHERE token = $1', [token]);
  }
}
