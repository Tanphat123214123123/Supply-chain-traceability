import { Database } from '../../db/database';
import { AnomalyType, STAGE_ORDER, SupplyChainStage } from '../../domain/types';
import { escapeLike } from './sql';

export interface ReportFilters {
  from: Date;
  to: Date;
  productType?: string;
  origin?: string;
}

export interface KpiValue {
  value: number;
  /** Same measure over the equally long window right before `from` — null when it can't be computed. */
  previous: number | null;
  /** 12 equal buckets across the window, oldest first. */
  trend: number[];
}

export interface ReportData {
  window: { from: Date; to: Date; previousFrom: Date };
  kpis: {
    batches: KpiValue;
    volumeKg: KpiValue;
    events: KpiValue;
    completionRate: KpiValue;
    recallRate: KpiValue;
    openAnomalies: KpiValue;
    avgLeadTimeDays: KpiValue;
    anchoredRate: KpiValue;
  };
  monthly: Array<{ month: string; batches: number; events: number; volumeKg: number; recalls: number; anomalies: number }>;
  funnel: Array<{ stage: SupplyChainStage; batches: number }>;
  stageDurations: Array<{ from: SupplyChainStage; to: SupplyChainStage; avgHours: number; samples: number }>;
  byProductType: Array<{ productType: string; batches: number; volumeKg: number }>;
  byOrigin: Array<{ origin: string; batches: number; anomalies: number; recalls: number }>;
  anomaliesByType: Array<{ type: AnomalyType; open: number; resolved: number }>;
  organizations: Array<{ organization: string; events: number; batches: number; anomalies: number; avgWaitHours: number | null }>;
  /** Options for the filter controls, independent of the current filter. */
  options: { productTypes: string[]; origins: string[] };
}

const KG = `CASE lower(b.unit) WHEN 'kg' THEN b.quantity WHEN 'tấn' THEN b.quantity * 1000 WHEN 'g' THEN b.quantity / 1000 END`;
const BUCKETS = 12;

/**
 * Aggregates for the Reports dashboard, all computed in Postgres over the
 * filtered lots (created inside the window, optional product type / origin).
 * Runs inside the tenant's scope.
 */
export class PostgresReportRepo {
  constructor(private readonly db: Database) {}

  async report(tenantId: string, f: ReportFilters): Promise<ReportData> {
    const span = f.to.getTime() - f.from.getTime();
    const previousFrom = new Date(f.from.getTime() - span);
    const type = f.productType ?? null;
    const origin = f.origin ? escapeLike(f.origin) : null;

    // Lots in [lo, hi) matching the dimension filters.
    const lots = (lo: string, hi: string) => `
      SELECT b.* FROM batches b
       WHERE b.tenant_id = $1 AND b.created_at >= ${lo} AND b.created_at < ${hi}
         AND ($4::text IS NULL OR b.product_type = $4)
         AND ($5::text IS NULL OR b.origin ILIKE '%' || $5 || '%')`;
    // Same SQL for both windows — only the bounds in $2/$3 differ.
    const params = [tenantId, f.from, f.to, type, origin];
    const prevParams = [tenantId, previousFrom, f.from, type, origin];
    const cur = lots('$2', '$3');

    // ── KPIs, current vs previous window ──
    const kpiSql = (scope: string) => `
      WITH f AS (${scope}),
      ev AS (SELECT e.* FROM trace_events e JOIN f ON f.id = e.batch_id),
      lead AS (
        SELECT f.id,
               EXTRACT(EPOCH FROM (max(e.timestamp) FILTER (WHERE e.stage = 'RETAIL') - min(e.timestamp))) / 86400 AS days
          FROM f JOIN trace_events e ON e.batch_id = f.id
         GROUP BY f.id
      )
      SELECT
        (SELECT count(*) FROM f)                                                  AS batches,
        (SELECT COALESCE(sum(${KG.replace(/b\./g, 'f.')}), 0) FROM f)            AS volume_kg,
        (SELECT count(*) FROM ev)                                                 AS events,
        (SELECT count(*) FROM f WHERE current_stage = 'RETAIL')                   AS completed,
        (SELECT count(*) FROM f WHERE is_recalled)                                AS recalled,
        (SELECT count(*) FROM anomalies a JOIN f ON f.id = a.batch_id WHERE NOT a.resolved) AS open_anomalies,
        (SELECT avg(days) FROM lead WHERE days IS NOT NULL)                       AS lead_days,
        (SELECT count(*) FROM ev JOIN anchor_leaves l ON l.event_id = ev.id
                               JOIN anchors an ON an.id = l.anchor_id AND an.status = 'confirmed') AS anchored`;
    type KpiRow = {
      batches: string;
      volume_kg: string;
      events: string;
      completed: string;
      recalled: string;
      open_anomalies: string;
      lead_days: string | null;
      anchored: string;
    };
    const [curK, prevK] = await Promise.all([
      this.db.query<KpiRow>(kpiSql(cur), params),
      this.db.query<KpiRow>(kpiSql(cur), prevParams),
    ]);
    const derive = (r: KpiRow) => {
      const batches = Number(r.batches);
      const events = Number(r.events);
      return {
        batches,
        volumeKg: Number(r.volume_kg),
        events,
        completionRate: batches ? (Number(r.completed) / batches) * 100 : 0,
        recallRate: batches ? (Number(r.recalled) / batches) * 100 : 0,
        openAnomalies: Number(r.open_anomalies),
        avgLeadTimeDays: r.lead_days === null ? null : Number(r.lead_days),
        anchoredRate: events ? (Number(r.anchored) / events) * 100 : 0,
      };
    };
    const c = derive(curK.rows[0]);
    const p = derive(prevK.rows[0]);

    // ── 12-bucket sparklines over the current window ──
    const trendRows = await this.db.query<{ bucket: number; batches: string; volume_kg: string; recalled: string; completed: string; events: string; anomalies: string }>(
      `WITH f AS (${cur}),
       fb AS (SELECT f.*, width_bucket(EXTRACT(EPOCH FROM f.created_at), EXTRACT(EPOCH FROM $2::timestamptz), EXTRACT(EPOCH FROM $3::timestamptz), ${BUCKETS}) AS bucket FROM f)
       SELECT g.bucket,
              (SELECT count(*) FROM fb WHERE fb.bucket = g.bucket) AS batches,
              (SELECT COALESCE(sum(${KG.replace(/b\./g, 'fb.')}), 0) FROM fb WHERE fb.bucket = g.bucket) AS volume_kg,
              (SELECT count(*) FROM fb WHERE fb.bucket = g.bucket AND fb.is_recalled) AS recalled,
              (SELECT count(*) FROM fb WHERE fb.bucket = g.bucket AND fb.current_stage = 'RETAIL') AS completed,
              (SELECT count(*) FROM trace_events e JOIN fb ON fb.id = e.batch_id WHERE fb.bucket = g.bucket) AS events,
              (SELECT count(*) FROM anomalies a JOIN fb ON fb.id = a.batch_id WHERE fb.bucket = g.bucket AND NOT a.resolved) AS anomalies
         FROM generate_series(1, ${BUCKETS}) AS g(bucket)
        ORDER BY g.bucket`,
      params,
    );
    const col = (k: keyof (typeof trendRows.rows)[number]) => trendRows.rows.map((r) => Number(r[k]));
    const tBatches = col('batches');
    const ratio = (num: number[], den: number[]) => num.map((n, i) => (den[i] ? (n / den[i]) * 100 : 0));

    // ── Monthly performance ──
    const monthly = await this.db.query<{ month: string; batches: string; events: string; volume_kg: string; recalls: string; anomalies: string }>(
      `WITH f AS (${cur}),
       m AS (SELECT generate_series(date_trunc('month', $2::timestamptz), date_trunc('month', $3::timestamptz - interval '1 microsecond'), interval '1 month') AS month)
       SELECT to_char(m.month, 'YYYY-MM') AS month,
              (SELECT count(*) FROM f WHERE date_trunc('month', f.created_at) = m.month) AS batches,
              (SELECT count(*) FROM trace_events e JOIN f ON f.id = e.batch_id WHERE date_trunc('month', e.timestamp) = m.month) AS events,
              (SELECT COALESCE(sum(${KG.replace(/b\./g, 'f.')}), 0) FROM f WHERE date_trunc('month', f.created_at) = m.month) AS volume_kg,
              (SELECT count(*) FROM f WHERE f.is_recalled AND date_trunc('month', f.created_at) = m.month) AS recalls,
              (SELECT count(*) FROM anomalies a JOIN f ON f.id = a.batch_id WHERE date_trunc('month', a.detected_at) = m.month) AS anomalies
         FROM m ORDER BY m.month`,
      params,
    );

    // ── Funnel: lots that reached each stage ──
    const funnel = await this.db.query<{ stage: SupplyChainStage; batches: string }>(
      `WITH f AS (${cur})
       SELECT s.stage, count(f.id) AS batches
         FROM unnest($6::text[]) WITH ORDINALITY AS s(stage, idx)
         LEFT JOIN f ON array_position($6::text[], f.current_stage) >= s.idx
        GROUP BY s.stage, s.idx ORDER BY s.idx`,
      [...params, STAGE_ORDER],
    );

    // ── Average time between consecutive stages ──
    const durations = await this.db.query<{ from_stage: SupplyChainStage; to_stage: SupplyChainStage; avg_hours: string; samples: string }>(
      `WITH f AS (${cur}),
       ev AS (
         SELECT e.stage, e.timestamp,
                lag(e.stage) OVER w AS prev_stage, lag(e.timestamp) OVER w AS prev_ts
           FROM trace_events e JOIN f ON f.id = e.batch_id
         WINDOW w AS (PARTITION BY e.batch_id ORDER BY e.sequence_number)
       )
       SELECT prev_stage AS from_stage, stage AS to_stage,
              avg(EXTRACT(EPOCH FROM (timestamp - prev_ts)) / 3600) AS avg_hours, count(*) AS samples
         FROM ev
        WHERE prev_stage IS NOT NULL
          AND array_position($6::text[], stage) = array_position($6::text[], prev_stage) + 1
        GROUP BY prev_stage, stage
        ORDER BY array_position($6::text[], prev_stage)`,
      [...params, STAGE_ORDER],
    );

    const byType = await this.db.query<{ product_type: string; batches: string; volume_kg: string }>(
      `WITH f AS (${cur})
       SELECT f.product_type, count(*) AS batches, COALESCE(sum(${KG.replace(/b\./g, 'f.')}), 0) AS volume_kg
         FROM f GROUP BY f.product_type ORDER BY batches DESC, f.product_type LIMIT 12`,
      params,
    );

    const byOrigin = await this.db.query<{ origin: string; batches: string; anomalies: string; recalls: string }>(
      `WITH f AS (${cur})
       SELECT f.origin, count(DISTINCT f.id) AS batches,
              count(a.id) AS anomalies,
              count(DISTINCT f.id) FILTER (WHERE f.is_recalled) AS recalls
         FROM f LEFT JOIN anomalies a ON a.batch_id = f.id
        GROUP BY f.origin ORDER BY batches DESC, f.origin LIMIT 10`,
      params,
    );

    const anomalyTypes = await this.db.query<{ type: AnomalyType; open: string; resolved: string }>(
      `WITH f AS (${cur})
       SELECT a.type, count(*) FILTER (WHERE NOT a.resolved) AS open, count(*) FILTER (WHERE a.resolved) AS resolved
         FROM anomalies a JOIN f ON f.id = a.batch_id
        GROUP BY a.type ORDER BY count(*) DESC`,
      params,
    );

    const orgs = await this.db.query<{ organization: string; events: string; batches: string; anomalies: string; avg_wait_hours: string | null }>(
      `WITH f AS (${cur}),
       ev AS (
         SELECT e.id, e.batch_id, e.actor_id, e.timestamp, lag(e.timestamp) OVER (PARTITION BY e.batch_id ORDER BY e.sequence_number) AS prev_ts
           FROM trace_events e JOIN f ON f.id = e.batch_id
       )
       SELECT ac.organization,
              count(ev.id) AS events,
              count(DISTINCT ev.batch_id) AS batches,
              (SELECT count(*) FROM anomalies a WHERE a.event_id IN (SELECT ev2.id FROM ev ev2 JOIN actors ac2 ON ac2.id = ev2.actor_id WHERE ac2.organization = ac.organization)) AS anomalies,
              avg(EXTRACT(EPOCH FROM (ev.timestamp - ev.prev_ts)) / 3600) AS avg_wait_hours
         FROM ev JOIN actors ac ON ac.id = ev.actor_id
        GROUP BY ac.organization
        ORDER BY events DESC, ac.organization LIMIT 15`,
      params,
    );

    const options = await this.db.query<{ kind: string; value: string }>(
      `SELECT DISTINCT 'type' AS kind, product_type AS value FROM batches WHERE tenant_id = $1
       UNION SELECT DISTINCT 'origin', origin FROM batches WHERE tenant_id = $1
       ORDER BY kind, value`,
      [tenantId],
    );

    const kpi = (value: number, previous: number | null, trend: number[]): KpiValue => ({ value, previous, trend });
    return {
      window: { from: f.from, to: f.to, previousFrom },
      kpis: {
        batches: kpi(c.batches, p.batches, tBatches),
        volumeKg: kpi(c.volumeKg, p.volumeKg, col('volume_kg')),
        events: kpi(c.events, p.events, col('events')),
        completionRate: kpi(c.completionRate, p.batches ? p.completionRate : null, ratio(col('completed'), tBatches)),
        recallRate: kpi(c.recallRate, p.batches ? p.recallRate : null, ratio(col('recalled'), tBatches)),
        openAnomalies: kpi(c.openAnomalies, p.openAnomalies, col('anomalies')),
        avgLeadTimeDays: kpi(c.avgLeadTimeDays ?? 0, p.avgLeadTimeDays, []),
        anchoredRate: kpi(c.anchoredRate, p.events ? p.anchoredRate : null, []),
      },
      monthly: monthly.rows.map((r) => ({
        month: r.month,
        batches: Number(r.batches),
        events: Number(r.events),
        volumeKg: Number(r.volume_kg),
        recalls: Number(r.recalls),
        anomalies: Number(r.anomalies),
      })),
      funnel: funnel.rows.map((r) => ({ stage: r.stage, batches: Number(r.batches) })),
      stageDurations: durations.rows.map((r) => ({
        from: r.from_stage,
        to: r.to_stage,
        avgHours: Number(r.avg_hours),
        samples: Number(r.samples),
      })),
      byProductType: byType.rows.map((r) => ({ productType: r.product_type, batches: Number(r.batches), volumeKg: Number(r.volume_kg) })),
      byOrigin: byOrigin.rows.map((r) => ({ origin: r.origin, batches: Number(r.batches), anomalies: Number(r.anomalies), recalls: Number(r.recalls) })),
      anomaliesByType: anomalyTypes.rows.map((r) => ({ type: r.type, open: Number(r.open), resolved: Number(r.resolved) })),
      organizations: orgs.rows.map((r) => ({
        organization: r.organization,
        events: Number(r.events),
        batches: Number(r.batches),
        anomalies: Number(r.anomalies),
        avgWaitHours: r.avg_wait_hours === null ? null : Number(r.avg_wait_hours),
      })),
      options: {
        productTypes: options.rows.filter((o) => o.kind === 'type').map((o) => o.value),
        origins: options.rows.filter((o) => o.kind === 'origin').map((o) => o.value),
      },
    };
  }
}
