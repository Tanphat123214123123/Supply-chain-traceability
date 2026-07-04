import { STAGE_ORDER, StatsByStage, StatsOverview } from '../domain/types';
import { verifyChain } from '../ledger/hashChain';
import { IBatchRepo, IEventRepo } from '../repository/interfaces';
import { detectAnomalies } from './anomalyDetector';

export class StatsService {
  constructor(
    private readonly batchRepo: IBatchRepo,
    private readonly eventRepo: IEventRepo,
  ) {}

  async overview(): Promise<StatsOverview> {
    const [batches, totalEvents] = await Promise.all([this.batchRepo.findAll(), this.eventRepo.countAll()]);
    const eventsByBatch = await Promise.all(batches.map((b) => this.eventRepo.findByBatchId(b.id)));

    let anomalyCount = 0;
    for (const events of eventsByBatch) {
      anomalyCount += detectAnomalies(events).length;
      if (!verifyChain(events)) anomalyCount += 1;
    }

    return {
      totalBatches: batches.length,
      activeBatches: batches.filter((b) => !b.isRecalled).length,
      recalledBatches: batches.filter((b) => b.isRecalled).length,
      totalEvents,
      anomalyCount,
    };
  }

  async byStage(): Promise<StatsByStage[]> {
    const batches = await this.batchRepo.findAll();
    const eventsByBatch = await Promise.all(batches.map((b) => this.eventRepo.findByBatchId(b.id)));
    const counts = new Map<string, number>(STAGE_ORDER.map((s) => [s, 0]));

    for (const events of eventsByBatch) {
      for (const event of events) {
        counts.set(event.stage, (counts.get(event.stage) ?? 0) + 1);
      }
    }

    return STAGE_ORDER.map((stage) => ({ stage, count: counts.get(stage) ?? 0 }));
  }
}
