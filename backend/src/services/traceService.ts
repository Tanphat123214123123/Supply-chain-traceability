import { Actor, Batch, PublicTrace, TraceEvent, TraceResult } from '../domain/types';
import { ChainVerification, verifyChain, verifyChainDetailed } from '../ledger/hashChain';
import { IAnomalyRepo, IBatchRepo, IEventRepo } from '../repository/interfaces';
import { NotFoundError } from './supplyChainService';

export type TraceDirection = 'forward' | 'backward';

export class TraceService {
  constructor(
    private readonly batchRepo: IBatchRepo,
    private readonly eventRepo: IEventRepo,
    private readonly anomalyRepo: IAnomalyRepo,
    private readonly signingKey: string,
  ) {}

  /**
   * `requester` is optional so this stays callable from tests/tools without a
   * full auth context — the authenticated `/trace/:batchId` route always
   * passes it, which is what actually enforces the tenant boundary.
   */
  async trace(batchId: string, direction: TraceDirection = 'forward', requester?: Actor): Promise<TraceResult> {
    const batch = await this.batchRepo.findById(batchId);
    if (!batch || (requester && batch.tenantId !== requester.tenantId)) throw new NotFoundError('Batch not found');

    const [ascending, anomalies] = await Promise.all([
      this.eventRepo.findByBatchId(batchId),
      this.anomalyRepo.findByBatchId(batchId),
    ]);
    const isValid = verifyChain(ascending, this.signingKey);

    const events = direction === 'backward' ? [...ascending].reverse() : ascending;

    return { batch, events, anomalies, isValid };
  }

  async publicTrace(batchId: string): Promise<PublicTrace> {
    const batch = await this.batchRepo.findById(batchId);
    if (!batch) throw new NotFoundError('Batch not found');

    const [events, anomalies] = await Promise.all([
      this.eventRepo.findByBatchId(batchId),
      this.anomalyRepo.findByBatchId(batchId),
    ]);
    const isValid = verifyChain(events, this.signingKey);
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

  /**
   * Full, unauthenticated chain-integrity check: every event's hash and link
   * to the previous one, laid bare — for the public "Chain Verifier" tool
   * aimed at technical auditors, as opposed to `publicTrace`'s curated summary
   * for end consumers.
   */
  async verifyPublic(batchId: string): Promise<{ batch: Pick<Batch, 'id' | 'productName'>; events: TraceEvent[] } & ChainVerification> {
    const batch = await this.batchRepo.findById(batchId);
    if (!batch) throw new NotFoundError('Batch not found');

    const events = await this.eventRepo.findByBatchId(batchId);
    const verification = verifyChainDetailed(events, this.signingKey);

    return { batch: { id: batch.id, productName: batch.productName }, events, ...verification };
  }
}
