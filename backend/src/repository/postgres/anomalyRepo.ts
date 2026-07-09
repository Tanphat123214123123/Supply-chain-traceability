import { Pool } from 'pg';
import { Anomaly, AnomalyListQuery, AnomalySeverity, AnomalyType, PaginatedResult } from '../../domain/types';
import { IAnomalyRepo } from '../interfaces';

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

export class PostgresAnomalyRepo implements IAnomalyRepo {
  constructor(private readonly pool: Pool) {}

  async create(anomaly: Anomaly): Promise<Anomaly> {
    await this.pool.query(
      `INSERT INTO anomalies (id, batch_id, event_id, type, severity, message, detected_at, resolved, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        anomaly.id,
        anomaly.batchId,
        anomaly.eventId ?? null,
        anomaly.type,
        anomaly.severity,
        anomaly.message,
        anomaly.detectedAt,
        anomaly.resolved,
        anomaly.tenantId,
      ],
    );
    return anomaly;
  }

  async findById(id: string): Promise<Anomaly | null> {
    const result = await this.pool.query<AnomalyRow>('SELECT * FROM anomalies WHERE id = $1', [id]);
    return result.rows[0] ? toAnomaly(result.rows[0]) : null;
  }

  async findByBatchId(batchId: string): Promise<Anomaly[]> {
    const result = await this.pool.query<AnomalyRow>(
      'SELECT * FROM anomalies WHERE batch_id = $1 ORDER BY detected_at ASC',
      [batchId],
    );
    return result.rows.map(toAnomaly);
  }

  async findPageByTenant(
    tenantId: string,
    { page, pageSize, resolved, severity }: AnomalyListQuery,
  ): Promise<PaginatedResult<Anomaly>> {
    const conditions: string[] = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];
    if (resolved !== undefined) {
      params.push(resolved);
      conditions.push(`resolved = $${params.length}`);
    }
    if (severity) {
      params.push(severity);
      conditions.push(`severity = $${params.length}`);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const offset = (page - 1) * pageSize;
    const rowsResult = await this.pool.query<AnomalyRow>(
      `SELECT * FROM anomalies ${where} ORDER BY detected_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );
    const countResult = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM anomalies ${where}`,
      params,
    );

    return {
      items: rowsResult.rows.map(toAnomaly),
      total: Number(countResult.rows[0]?.count ?? 0),
      page,
      pageSize,
    };
  }

  async resolve(id: string, resolvedBy: string): Promise<Anomaly | null> {
    const result = await this.pool.query<AnomalyRow>(
      `UPDATE anomalies SET resolved = true, resolved_by = $2, resolved_at = now() WHERE id = $1 RETURNING *`,
      [id, resolvedBy],
    );
    return result.rows[0] ? toAnomaly(result.rows[0]) : null;
  }

  async countAllByTenant(tenantId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM anomalies WHERE tenant_id = $1',
      [tenantId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async findAllByTenant(tenantId: string): Promise<Anomaly[]> {
    const result = await this.pool.query<AnomalyRow>('SELECT * FROM anomalies WHERE tenant_id = $1', [tenantId]);
    return result.rows.map(toAnomaly);
  }
}
