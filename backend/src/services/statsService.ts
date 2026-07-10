import { STAGE_ORDER, StatsByDay, StatsByOrigin, StatsByStage, StatsOverview } from '../domain/types';
import { IAnomalyRepo, IBatchRepo, IEventRepo } from '../repository/interfaces';

export class StatsService {
  constructor(
    private readonly batchRepo: IBatchRepo,
    private readonly eventRepo: IEventRepo,
    private readonly anomalyRepo: IAnomalyRepo,
  ) {}

  async overview(tenantId: string): Promise<StatsOverview> {
    const batches = await this.batchRepo.findAllByTenant(tenantId);
    const [totalEvents, anomalyCount] = await Promise.all([
      this.eventRepo.countAllForBatchIds(batches.map((b) => b.id)),
      // Includes CHAIN_TAMPERED anomalies — those are persisted by
      // AdminService.scanForTamperedChains (run at startup and on-demand),
      // so a single count here covers both rule-based and tamper anomalies
      // without an N+1 re-verify-every-batch sweep on every dashboard load.
      this.anomalyRepo.countAllByTenant(tenantId),
    ]);

    return {
      totalBatches: batches.length,
      activeBatches: batches.filter((b) => !b.isRecalled).length,
      recalledBatches: batches.filter((b) => b.isRecalled).length,
      totalEvents,
      anomalyCount,
    };
  }

  async byStage(tenantId: string): Promise<StatsByStage[]> {
    const batches = await this.batchRepo.findAllByTenant(tenantId);
    const counts = await this.eventRepo.countByStageForBatchIds(batches.map((b) => b.id));
    return STAGE_ORDER.map((stage) => ({ stage, count: counts[stage] ?? 0 }));
  }

  /** Batches created per day, most recent 30 days with any activity, oldest first. */
  async byDay(tenantId: string): Promise<StatsByDay[]> {
    const batches = await this.batchRepo.findAllByTenant(tenantId);
    const counts = new Map<string, number>();
    for (const batch of batches) {
      const date = batch.createdAt.toISOString().slice(0, 10);
      counts.set(date, (counts.get(date) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([date, count]) => ({ date, count }));
  }

  async byOrigin(tenantId: string): Promise<StatsByOrigin[]> {
    const [batches, anomalies] = await Promise.all([
      this.batchRepo.findAllByTenant(tenantId),
      this.anomalyRepo.findAllByTenant(tenantId),
    ]);

    const originByBatchId = new Map(batches.map((b) => [b.id, b.origin]));
    const anomalyCountByOrigin = new Map<string, number>();
    for (const anomaly of anomalies) {
      const origin = originByBatchId.get(anomaly.batchId);
      if (!origin) continue;
      anomalyCountByOrigin.set(origin, (anomalyCountByOrigin.get(origin) ?? 0) + 1);
    }

    const byOrigin = new Map<string, StatsByOrigin>();
    for (const batch of batches) {
      const existing = byOrigin.get(batch.origin);
      if (existing) {
        existing.batchCount += 1;
      } else {
        byOrigin.set(batch.origin, {
          origin: batch.origin,
          batchCount: 1,
          anomalyCount: anomalyCountByOrigin.get(batch.origin) ?? 0,
        });
      }
    }

    return [...byOrigin.values()].sort((a, b) => b.batchCount - a.batchCount);
  }
}
