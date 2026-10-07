import { Database } from '../db/database';
import {
  Actor,
  Batch,
  PUBLIC_EVENT_FIELDS,
  PublicJourneyStep,
  PublicTrace,
  TraceEvent,
  TraceResult,
} from '../domain/types';
import { ChainVerification, verifyChainDetailed, VerifyOptions } from '../ledger/hashChain';
import { IActorRepo, IAnomalyRepo, IBatchRepo, IEventRepo } from '../repository/interfaces';
import { NotFoundError } from './supplyChainService';

export type TraceDirection = 'forward' | 'backward';

export interface TraceRepos {
  batchRepo: IBatchRepo;
  eventRepo: IEventRepo;
  anomalyRepo: IAnomalyRepo;
  actorRepo: IActorRepo;
}

/** Only the whitelisted, scalar facts of an event may leave the tenant. */
function publicDetails(event: TraceEvent): PublicJourneyStep['details'] {
  const details: PublicJourneyStep['details'] = {};
  for (const key of PUBLIC_EVENT_FIELDS[event.stage]) {
    const value = event.data[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') details[key] = value;
  }
  return details;
}

export type PublicVerification = {
  batch: Pick<Batch, 'id' | 'productName'>;
  events: Omit<TraceEvent, 'tenantId'>[];
} & ChainVerification;

export class TraceService {
  constructor(
    private readonly db: Database,
    private readonly repos: TraceRepos,
    /** Only needed to re-verify legacy v1 (HMAC) events; v2 events need no secret at all. */
    private readonly legacyLedgerKey?: string,
  ) {}

  private verifyOptions(batch: Batch): VerifyOptions {
    return { legacyKey: this.legacyLedgerKey, head: { hash: batch.headHash, eventCount: batch.eventCount } };
  }

  async trace(batchId: string, direction: TraceDirection, requester: Actor): Promise<TraceResult> {
    return this.db.withTenant(requester.tenantId, async () => {
      const batch = await this.repos.batchRepo.findById(batchId);
      if (!batch || batch.tenantId !== requester.tenantId) throw new NotFoundError('Batch not found');

      const [ascending, anomalies] = await Promise.all([
        this.repos.eventRepo.findByBatchId(batchId),
        this.repos.anomalyRepo.findByBatchId(batchId),
      ]);
      const { valid } = verifyChainDetailed(ascending, this.verifyOptions(batch));
      const events = direction === 'backward' ? [...ascending].reverse() : ascending;
      return { batch, events, anomalies, isValid: valid };
    });
  }

  /**
   * Public lookups arrive with only a batch id (from a QR code), so the
   * owning tenant is resolved first through a SECURITY DEFINER function that
   * reveals nothing but that id — everything after runs in a normal
   * tenant-scoped transaction under row-level security.
   */
  private async inPublicScope<T>(batchId: string, fn: (batch: Batch) => Promise<T>): Promise<T> {
    const tenantId = await this.repos.batchRepo.resolveTenantId(batchId);
    if (!tenantId) throw new NotFoundError('Batch not found');
    return this.db.withTenant(tenantId, async () => {
      const batch = await this.repos.batchRepo.findById(batchId);
      if (!batch) throw new NotFoundError('Batch not found');
      return fn(batch);
    });
  }

  async publicTrace(batchId: string): Promise<PublicTrace> {
    return this.inPublicScope(batchId, async (batch) => {
      const [events, anomalies] = await Promise.all([
        this.repos.eventRepo.findByBatchId(batchId),
        this.repos.anomalyRepo.findByBatchId(batchId),
      ]);
      const { valid } = verifyChainDetailed(events, this.verifyOptions(batch));

      // Organizations, never people: a consumer sees "Xưởng chế biến An Giang",
      // not the name or email of the employee who scanned the batch in.
      const organizations = new Map<string, string>();
      for (const actorId of new Set(events.map((e) => e.actorId))) {
        const actor = await this.repos.actorRepo.findById(actorId);
        organizations.set(actorId, actor?.organization ?? '');
      }
      const journey: PublicJourneyStep[] = events.map((e) => ({
        stage: e.stage,
        timestamp: e.timestamp,
        location: e.location,
        organization: organizations.get(e.actorId) ?? '',
        details: publicDetails(e),
      }));

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
        stageCount: new Set(events.map((e) => e.stage)).size,
        isValid: valid,
        hasAnomalies: anomalies.some((a) => !a.resolved),
        journey,
      };
    });
  }

  /**
   * Full, unauthenticated chain-integrity check for the public "Chain
   * Verifier": every event with everything needed to recompute its v2 hash
   * independently (including the salt), the per-event result, and whether
   * the chain ends at the head the database recorded.
   */
  async verifyPublic(batchId: string): Promise<PublicVerification> {
    return this.inPublicScope(batchId, async (batch) => {
      const events = await this.repos.eventRepo.findByBatchId(batchId);
      const verification = verifyChainDetailed(events, this.verifyOptions(batch));
      // The tenant id is internal bookkeeping, not part of the hash preimage — don't publish it.
      const publicEvents = events.map(({ tenantId: _internal, ...rest }) => rest);
      return { batch: { id: batch.id, productName: batch.productName }, events: publicEvents, ...verification };
    });
  }
}
