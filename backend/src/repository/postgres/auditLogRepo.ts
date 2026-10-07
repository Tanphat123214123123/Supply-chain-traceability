import { Database } from '../../db/database';
import { AuditLogEntry, PaginatedResult } from '../../domain/types';
import { IAuditLogRepo } from '../interfaces';
import { involvesActor, WithTotal } from './sql';

interface AuditLogRow {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  tenant_id: string;
}

const COLUMNS = 'l.id, l.actor_id, l.action, l.entity_type, l.entity_id, l.metadata, l.created_at, l.tenant_id';

function toEntry(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    actorId: row.actor_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: row.metadata,
    createdAt: row.created_at,
    tenantId: row.tenant_id,
  };
}

export class PostgresAuditLogRepo implements IAuditLogRepo {
  constructor(private readonly db: Database) {}

  async create(entry: AuditLogEntry): Promise<AuditLogEntry> {
    await this.db.query(
      `INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata, created_at, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.id,
        entry.actorId,
        entry.action,
        entry.entityType,
        entry.entityId,
        JSON.stringify(entry.metadata ?? {}),
        entry.createdAt,
        entry.tenantId,
      ],
    );
    return entry;
  }

  async findPageByTenant(tenantId: string, page: number, pageSize: number): Promise<PaginatedResult<AuditLogEntry>> {
    const offset = (page - 1) * pageSize;
    const result = await this.db.query<AuditLogRow & WithTotal>(
      `SELECT ${COLUMNS}, count(*) OVER () AS total_count
         FROM audit_logs l
        WHERE l.tenant_id = $1
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT $2 OFFSET $3`,
      [tenantId, pageSize, offset],
    );

    let total = result.rows[0] ? Number(result.rows[0].total_count) : 0;
    if (result.rows.length === 0 && offset > 0) {
      const count = await this.db.query<{ count: string }>('SELECT count(*) AS count FROM audit_logs WHERE tenant_id = $1', [
        tenantId,
      ]);
      total = Number(count.rows[0].count);
    }
    return { items: result.rows.map(toEntry), total, page, pageSize };
  }

  async findRecentBatchAction(
    tenantId: string,
    action: string,
    limit: number,
    involvingActorId?: string,
  ): Promise<AuditLogEntry[]> {
    const result = await this.db.query<AuditLogRow>(
      `SELECT ${COLUMNS}
         FROM audit_logs l
        WHERE l.tenant_id = $1
          AND l.action = $2
          AND l.entity_type = 'batch'
          AND ($4::uuid IS NULL OR EXISTS (
                SELECT 1 FROM batches b WHERE b.id::text = l.entity_id AND ${involvesActor('$4')}))
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT $3`,
      [tenantId, action, limit, involvingActorId ?? null],
    );
    return result.rows.map(toEntry);
  }
}
