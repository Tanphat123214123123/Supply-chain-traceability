import { Database, isUuid } from '../../db/database';
import { Anomaly, AnomalyListQuery, AnomalySeverity, AnomalyType, PaginatedResult } from '../../domain/types';
import { IAnomalyRepo } from '../interfaces';
import { involvesActor, WithTotal } from './sql';

interface AnomalyRow {
  id: string;
  batch_id: string;
  event_id: string | null;
  type: AnomalyType;
  severity: AnomalySeverity;
  message: string;
  detected_at: Date;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: Date | null;
  tenant_id: string;
}

const COLUMNS = 'a.id, a.batch_id, a.event_id, a.type, a.severity, a.message, a.detected_at, a.resolved, a.resolved_by, a.resolved_at, a.tenant_id';

function toAnomaly(row: AnomalyRow): Anomaly {
  return {
    id: row.id,
    batchId: row.batch_id,
    tenantId: row.tenant_id,
    eventId: row.event_id ?? undefined,
    type: row.type,
    severity: row.severity,
    message: row.message,
    detectedAt: row.detected_at,
    resolved: row.resolved,
    resolvedBy: row.resolved_by ?? undefined,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

const INSERT_SQL = `INSERT INTO anomalies (id, batch_id, event_id, type, severity, message, detected_at, resolved, tenant_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)`;

function insertParams(anomaly: Anomaly): unknown[] {
  return [
    anomaly.id,
    anomaly.batchId,
    anomaly.eventId ?? null,
    anomaly.type,
    anomaly.severity,
    anomaly.message,
    anomaly.detectedAt,
    anomaly.tenantId,
  ];
}

export class PostgresAnomalyRepo implements IAnomalyRepo {
  constructor(private readonly db: Database) {}

  async create(anomaly: Anomaly): Promise<Anomaly> {
    await this.db.query(INSERT_SQL, insertParams(anomaly));
    return { ...anomaly, resolved: false };
  }

  async createTamperAlertIfAbsent(anomaly: Anomaly): Promise<Anomaly | null> {
    const result = await this.db.query(
      `${INSERT_SQL}
       ON CONFLICT (batch_id) WHERE type = 'CHAIN_TAMPERED' AND NOT resolved DO NOTHING
       RETURNING id`,
      insertParams({ ...anomaly, type: 'CHAIN_TAMPERED' }),
    );
    return result.rows.length > 0 ? { ...anomaly, type: 'CHAIN_TAMPERED', resolved: false } : null;
  }

  async findById(id: string): Promise<Anomaly | null> {
    if (!isUuid(id)) return null;
    const result = await this.db.query<AnomalyRow>(`SELECT ${COLUMNS} FROM anomalies a WHERE a.id = $1`, [id]);
    return result.rows[0] ? toAnomaly(result.rows[0]) : null;
  }

  async findByBatchId(batchId: string): Promise<Anomaly[]> {
    if (!isUuid(batchId)) return [];
    const result = await this.db.query<AnomalyRow>(
      `SELECT ${COLUMNS} FROM anomalies a WHERE a.batch_id = $1 ORDER BY a.detected_at ASC, a.id ASC`,
      [batchId],
    );
    return result.rows.map(toAnomaly);
  }

  async findPageByTenant(
    tenantId: string,
    { page, pageSize, resolved, severity }: AnomalyListQuery,
  ): Promise<PaginatedResult<Anomaly>> {
    const offset = (page - 1) * pageSize;
    const where = `a.tenant_id = $1
      AND ($2::boolean IS NULL OR a.resolved = $2)
      AND ($3::text IS NULL OR a.severity = $3)`;
    const params = [tenantId, resolved ?? null, severity ?? null];

    const result = await this.db.query<AnomalyRow & WithTotal>(
      `SELECT ${COLUMNS}, count(*) OVER () AS total_count
         FROM anomalies a
        WHERE ${where}
        ORDER BY a.detected_at DESC, a.id DESC
        LIMIT $4 OFFSET $5`,
      [...params, pageSize, offset],
    );

    let total = result.rows[0] ? Number(result.rows[0].total_count) : 0;
    if (result.rows.length === 0 && offset > 0) {
      const count = await this.db.query<{ count: string }>(`SELECT count(*) AS count FROM anomalies a WHERE ${where}`, params);
      total = Number(count.rows[0].count);
    }
    return { items: result.rows.map(toAnomaly), total, page, pageSize };
  }

  async resolve(id: string, resolvedBy: string): Promise<Anomaly | null> {
    if (!isUuid(id)) return null;
    const result = await this.db.query<AnomalyRow>(
      `UPDATE anomalies AS a SET resolved = true, resolved_by = $2, resolved_at = now()
        WHERE a.id = $1 AND NOT a.resolved
        RETURNING ${COLUMNS}`,
      [id, resolvedBy],
    );
    return result.rows[0] ? toAnomaly(result.rows[0]) : null;
  }

  async findRecent(tenantId: string, limit: number, involvingActorId?: string): Promise<Anomaly[]> {
    const result = await this.db.query<AnomalyRow>(
      `SELECT ${COLUMNS}
         FROM anomalies a
        WHERE a.tenant_id = $1
          AND ($3::uuid IS NULL OR EXISTS (
                SELECT 1 FROM batches b WHERE b.id = a.batch_id AND ${involvesActor('$3')}))
        ORDER BY a.detected_at DESC, a.id DESC
        LIMIT $2`,
      [tenantId, limit, involvingActorId ?? null],
    );
    return result.rows.map(toAnomaly);
  }
}
