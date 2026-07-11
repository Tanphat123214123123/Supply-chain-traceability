import { Pool } from 'pg';
import { AuditLogEntry, PaginatedResult } from '../../domain/types';
import { IAuditLogRepo } from '../interfaces';

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
  constructor(private readonly pool: Pool) {}

  async create(entry: AuditLogEntry): Promise<AuditLogEntry> {
    await this.pool.query(
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
    const [rows, count] = await Promise.all([
      this.pool.query<AuditLogRow>(
        'SELECT * FROM audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [tenantId, pageSize, offset],
      ),
      this.pool.query<{ count: string }>('SELECT count(*)::text AS count FROM audit_logs WHERE tenant_id = $1', [tenantId]),
    ]);
    return {
      items: rows.rows.map(toEntry),
      total: Number(count.rows[0]?.count ?? 0),
      page,
      pageSize,
    };
  }

  async findByActionAndTenant(action: string, tenantId: string, limit: number): Promise<AuditLogEntry[]> {
    const result = await this.pool.query<AuditLogRow>(
      'SELECT * FROM audit_logs WHERE action = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT $3',
      [action, tenantId, limit],
    );
    return result.rows.map(toEntry);
  }
}
