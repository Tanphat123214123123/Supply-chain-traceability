import { Database } from '../db/database';
import { STAGE_ORDER, StatsByDay, StatsByOrigin, StatsByStage, StatsOverview } from '../domain/types';
import { IStatsRepo } from '../repository/interfaces';

/** How many most-recent active days the "batches per day" chart shows. */
const DAYS_SHOWN = 30;

export class StatsService {
  constructor(
    private readonly db: Database,
    private readonly statsRepo: IStatsRepo,
  ) {}

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
}
