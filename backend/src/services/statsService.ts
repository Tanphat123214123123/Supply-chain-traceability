import { Database } from '../db/database';
import {
  AttentionSummary,
  STALLED_AFTER_DAYS,
  STAGE_ORDER,
  StatsByDay,
  StatsByOrigin,
  StatsByStage,
  StatsOverview,
} from '../domain/types';
import { IStatsRepo } from '../repository/interfaces';
import { PostgresReportRepo, ReportData, ReportFilters } from '../repository/postgres/reportRepo';

/** How many most-recent active days the "batches per day" chart shows. */
const DAYS_SHOWN = 30;

export class StatsService {
  constructor(
    private readonly db: Database,
    private readonly statsRepo: IStatsRepo,
    private readonly reportRepo?: PostgresReportRepo,
  ) {}

  /** Everything the Reports dashboard shows, for one filtered window (default: last 180 days). */
  async report(tenantId: string, filters: Partial<ReportFilters>): Promise<ReportData> {
    if (!this.reportRepo) throw new Error('Report repository not configured');
    const to = filters.to ?? new Date();
    const from = filters.from ?? new Date(to.getTime() - 180 * 24 * 3600 * 1000);
    return this.db.withTenant(tenantId, () =>
      this.reportRepo!.report(tenantId, { from, to, productType: filters.productType, origin: filters.origin }),
    );
  }

  /**
   * `anomalyCount` includes CHAIN_TAMPERED anomalies — those are persisted by
   * AdminService.scanForTamperedChains, so a single count covers both
   * rule-based and tamper anomalies without re-verifying chains per request.
   */
  async overview(tenantId: string): Promise<StatsOverview> {
    return this.db.withTenant(tenantId, () => this.statsRepo.overview(tenantId));
  }

  async byStage(tenantId: string): Promise<StatsByStage[]> {
    const counts = await this.db.withTenant(tenantId, () => this.statsRepo.eventCountByStage(tenantId));
    return STAGE_ORDER.map((stage) => ({ stage, count: counts[stage] ?? 0 }));
  }

  /** Batches created per day, most recent 30 days with any activity, oldest first. */
  async byDay(tenantId: string): Promise<StatsByDay[]> {
    return this.db.withTenant(tenantId, () => this.statsRepo.batchesPerDay(tenantId, DAYS_SHOWN));
  }

  async byOrigin(tenantId: string): Promise<StatsByOrigin[]> {
    return this.db.withTenant(tenantId, () => this.statsRepo.byOrigin(tenantId));
  }

  /** "What needs a human today": batches stuck at a stage, and anomalies nobody has resolved. */
  async attention(tenantId: string): Promise<AttentionSummary> {
    return this.db.withTenant(tenantId, () => this.statsRepo.attention(tenantId, STALLED_AFTER_DAYS, 8));
  }
}
