import { PublicTrace, TraceResult } from '../domain/types';
import { verifyChain } from '../ledger/hashChain';
import { IBatchRepo, IEventRepo } from '../repository/interfaces';
import { detectAnomalies } from './anomalyDetector';
import { NotFoundError } from './supplyChainService';

export type TraceDirection = 'forward' | 'backward';

export class TraceService {
  constructor(
    private readonly batchRepo: IBatchRepo,
    private readonly eventRepo: IEventRepo,
  ) {}

  async trace(batchId: string, direction: TraceDirection = 'forward'): Promise<TraceResult> {
    const batch = await this.batchRepo.findById(batchId);
    if (!batch) throw new NotFoundError('Batch not found');

    const ascending = await this.eventRepo.findByBatchId(batchId);
    const isValid = verifyChain(ascending);
    const anomalies = detectAnomalies(ascending);

    const events = direction === 'backward' ? [...ascending].reverse() : ascending;

    return { batch, events, anomalies, isValid };
  }

  async publicTrace(batchId: string): Promise<PublicTrace> {
    const batch = await this.batchRepo.findById(batchId);
    if (!batch) throw new NotFoundError('Batch not found');

    const events = await this.eventRepo.findByBatchId(batchId);
    const isValid = verifyChain(events);
    const anomalies = detectAnomalies(events);
    const stageCount = new Set(events.map((e) => e.stage)).size;

    return {
      batch: {
        id: batch.id,
        productName: batch.productName,
        productType: batch.productType,
        origin: batch.origin,
        currentStage: batch.currentStage,
        isRecalled: batch.isRecalled,
        recallReason: batch.recallReason,
      },
      stageCount,
      isValid,
      hasAnomalies: anomalies.length > 0,
    };
  }
}
