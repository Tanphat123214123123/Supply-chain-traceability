import { Database } from '../../db/database';
import { StatsByDay, StatsByOrigin, StatsOverview, SupplyChainStage } from '../../domain/types';
import { IStatsRepo } from '../interfaces';

/** Dashboard aggregates computed by Postgres — no table is ever pulled into application memory. */
export class PostgresStatsRepo implements IStatsRepo {
  constructor(private readonly db: Database) {}

  async overview(tenantId: string): Promise<StatsOverview> {
    const result = await this.db.query<{
      total_batches: string;
      recalled_batches: string;
      total_events: string;
      anomaly_count: string;
    }>(
      `SELECT
         (SELECT count(*) FROM batches WHERE tenant_id = $1)                      AS total_batches,
         (SELECT count(*) FROM batches WHERE tenant_id = $1 AND is_recalled)      AS recalled_batches,
         (SELECT count(*) FROM trace_events WHERE tenant_id = $1)                 AS total_events,
         (SELECT count(*) FROM anomalies WHERE tenant_id = $1)                    AS anomaly_count`,
      [tenantId],
    );
    const row = result.rows[0];
    const totalBatches = Number(row.total_batches);
    const recalledBatches = Number(row.recalled_batches);
    return {
      totalBatches,
      activeBatches: totalBatches - recalledBatches,
      recalledBatches,
      totalEvents: Number(row.total_events),
      anomalyCount: Number(row.anomaly_count),
    };
  }

  async eventCountByStage(tenantId: string): Promise<Partial<Record<SupplyChainStage, number>>> {
    const result = await this.db.query<{ stage: SupplyChainStage; count: string }>(
      'SELECT stage, count(*) AS count FROM trace_events WHERE tenant_id = $1 GROUP BY stage',
      [tenantId],
    );
    const counts: Partial<Record<SupplyChainStage, number>> = {};
    for (const row of result.rows) counts[row.stage] = Number(row.count);
    return counts;
  }

  /** The most recent `days` calendar days (UTC) that had any batch created, oldest first. */
  async batchesPerDay(tenantId: string, days: number): Promise<StatsByDay[]> {
    const result = await this.db.query<{ date: string; count: string }>(
      `SELECT date, count FROM (
         SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date, count(*) AS count
           FROM batches
          WHERE tenant_id = $1
          GROUP BY 1
          ORDER BY 1 DESC
          LIMIT $2
       ) recent
       ORDER BY date ASC`,
      [tenantId, days],
    );
    return result.rows.map((r) => ({ date: r.date, count: Number(r.count) }));
  }

  async byOrigin(tenantId: string): Promise<StatsByOrigin[]> {
    const result = await this.db.query<{ origin: string; batch_count: string; anomaly_count: string }>(
      `SELECT b.origin,
              count(DISTINCT b.id) AS batch_count,
              count(a.id)          AS anomaly_count
         FROM batches b
         LEFT JOIN anomalies a ON a.batch_id = b.id
        WHERE b.tenant_id = $1
        GROUP BY b.origin
        ORDER BY batch_count DESC, b.origin ASC`,
      [tenantId],
    );
    return result.rows.map((r) => ({
      origin: r.origin,
      batchCount: Number(r.batch_count),
      anomalyCount: Number(r.anomaly_count),
    }));
  }
}
