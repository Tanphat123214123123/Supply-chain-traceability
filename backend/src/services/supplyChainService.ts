import { v4 as uuidv4 } from 'uuid';
import { Database } from '../db/database';
import {
  Actor,
  Anomaly,
  Batch,
  BatchListQuery,
  CreateBatchDTO,
  RecordEventDTO,
  ROLE_STAGES,
  STAGE_ORDER,
  TraceEvent,
} from '../domain/types';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { computeEventHashV2, CURRENT_HASH_VERSION, newEventSalt } from '../ledger/hashChain';
import { BatchExportFilters, IActorRepo, IAnomalyRepo, IAuditLogRepo, IBatchRepo, IEventRepo } from '../repository/interfaces';
import { detectNewAnomalies } from './anomalyDetector';
import { getInvolvedActorIds } from './notificationScope';

export { ConflictError, ForbiddenError, NotFoundError };

export interface RealtimeEmitter {
  emitAnomaly(anomaly: Anomaly, recipientActorIds: string[]): void;
  emitRecall(batch: Batch, recipientActorIds: string[]): void;
}

export interface SupplyChainRepos {
  batchRepo: IBatchRepo;
  eventRepo: IEventRepo;
  anomalyRepo: IAnomalyRepo;
  auditLogRepo: IAuditLogRepo;
  actorRepo: IActorRepo;
}

export class SupplyChainService {
  constructor(
    private readonly db: Database,
    private readonly repos: SupplyChainRepos,
    private readonly realtime?: RealtimeEmitter,
  ) {}

  async createBatch(actor: Actor, dto: CreateBatchDTO): Promise<Batch> {
    return this.db.withTenant(actor.tenantId, async () => {
      const batch = await this.repos.batchRepo.create({
        id: uuidv4(),
        productName: dto.productName,
        productType: dto.productType,
        origin: dto.origin,
        quantity: dto.quantity,
        unit: dto.unit,
        createdAt: new Date(),
        createdBy: actor.id,
        tenantId: actor.tenantId,
        currentStage: null,
        isRecalled: false,
        metadata: dto.metadata ?? {},
        // The creator is who's expected to record the first event (they're the
        // one who actually has the physical goods in hand right now).
        assignedToActorId: actor.id,
      });
      await this.audit(actor, 'BATCH_CREATED', 'batch', batch.id, { productName: batch.productName });
      return batch;
    });
  }

  /** Whether a tenant has any batch at all — used to keep demo seeding idempotent. */
  async tenantHasBatches(tenantId: string): Promise<boolean> {
    return this.db.withTenant(tenantId, () => this.repos.batchRepo.hasAnyInTenant(tenantId));
  }

  async listBatchesPage(actor: Actor, query: BatchListQuery) {
    return this.db.withTenant(actor.tenantId, () => this.repos.batchRepo.findPageByTenant(actor.tenantId, query));
  }

  /**
   * Non-recalled batches whose next stage this actor's role can record AND
   * that are actually theirs to act on — either explicitly assigned to them,
   * unclaimed (legacy data / an admin left it open), or any batch at all if
   * they're an ADMIN. A "my work queue" view.
   */
  async listPendingForActor(actor: Actor): Promise<Batch[]> {
    return this.db.withTenant(actor.tenantId, () =>
      this.repos.batchRepo.findPendingFor(actor.tenantId, actor.id, ROLE_STAGES[actor.role], actor.role === 'ADMIN'),
    );
  }

  /** Batches filtered by creation date range and/or origin, for compliance/reporting export. */
  async exportBatches(actor: Actor, filters: BatchExportFilters): Promise<Batch[]> {
    return this.db.withTenant(actor.tenantId, () => this.repos.batchRepo.findForExport(actor.tenantId, filters));
  }

  async getBatch(actor: Actor, id: string): Promise<Batch> {
    return this.db.withTenant(actor.tenantId, async () => {
      const batch = await this.repos.batchRepo.findById(id);
      // Same NotFoundError for "doesn't exist" and "exists but belongs to
      // another tenant" — a 403 would confirm the batch exists to someone
      // who has no business knowing that. (RLS already hides other tenants'
      // rows; the explicit check documents the intent.)
      if (!batch || batch.tenantId !== actor.tenantId) throw new NotFoundError('Batch not found');
      return batch;
    });
  }

  /** Throws unless `actor` is the batch's current custodian (or ADMIN, which overrides). */
  private assertCustody(actor: Actor, batch: Pick<Batch, 'assignedToActorId'>): void {
    if (actor.role === 'ADMIN') return;
    if (batch.assignedToActorId && batch.assignedToActorId !== actor.id) {
      throw new ForbiddenError('This batch has not been handed off to you yet');
    }
  }

  /**
   * Validates the hand-off for the NEXT stage and returns the actorId that
   * should become the batch's new custodian — null if the chain is complete
   * (terminal stage) or an ADMIN deliberately left it unclaimed. Only called
   * when `newStageIndex` is a genuine forward advance, so a backfilled or
   * duplicate stage recording never disturbs the current hand-off.
   */
  private async resolveNextAssignee(
    actor: Actor,
    newStageIndex: number,
    assignNextTo: string | undefined,
  ): Promise<string | null> {
    const isTerminal = newStageIndex === STAGE_ORDER.length - 1;
    if (isTerminal) return null;

    if (!assignNextTo) {
      if (actor.role === 'ADMIN') return null;
      throw new ConflictError('You must designate who handles the next stage before completing this one');
    }

    const nextActor = await this.repos.actorRepo.findById(assignNextTo);
    if (!nextActor || nextActor.tenantId !== actor.tenantId) throw new NotFoundError('Assigned actor not found');
    if (!nextActor.isActive) throw new ConflictError('Assigned actor account is inactive');

    const nextStage = STAGE_ORDER[newStageIndex + 1];
    if (!ROLE_STAGES[nextActor.role].includes(nextStage)) {
      throw new ConflictError(`${nextActor.role} cannot handle stage ${nextStage}`);
    }

    return nextActor.id;
  }

  /**
   * One transaction, one row lock: the batch row is locked FOR UPDATE, so
   * concurrent recordings on the same batch — from this process or any other
   * replica — serialise, and each sees the head left by the previous one.
   * The ledger trigger re-validates the linkage at INSERT time as a backstop.
   * Realtime pushes happen only after COMMIT, so nobody is ever notified
   * about an event that was rolled back.
   */
  async recordEvent(actor: Actor, dto: RecordEventDTO): Promise<TraceEvent> {
    if (!ROLE_STAGES[actor.role].includes(dto.stage)) {
      throw new ForbiddenError(`Role ${actor.role} is not permitted to record stage ${dto.stage}`);
    }

    const { event, newAnomalies, recipients } = await this.db.withTenant(actor.tenantId, async () => {
      const batch = await this.repos.batchRepo.findByIdForUpdate(dto.batchId);
      // Same tenant check regardless of role — ADMIN is scoped to its own
      // tenant, not a cross-tenant platform role, and assertCustody below
      // deliberately lets ADMIN bypass the custody check, so this must come first.
      if (!batch || batch.tenantId !== actor.tenantId) throw new NotFoundError('Batch not found');
      if (batch.isRecalled) throw new ConflictError('Batch has been recalled — no further events allowed');
      this.assertCustody(actor, batch);

      const newIndex = STAGE_ORDER.indexOf(dto.stage);
      const currentIndex = batch.currentStage ? STAGE_ORDER.indexOf(batch.currentStage) : -1;
      const isAdvancing = newIndex > currentIndex;
      // Resolve (and validate) the hand-off BEFORE writing anything.
      const nextAssignee = isAdvancing
        ? await this.resolveNextAssignee(actor, newIndex, dto.assignNextTo)
        : (batch.assignedToActorId ?? null);

      const salt = newEventSalt();
      const unhashed = {
        batchId: batch.id,
        stage: dto.stage,
        actorId: actor.id,
        timestamp: new Date(),
        location: dto.location,
        notes: dto.notes,
        data: dto.data ?? {},
        prevHash: batch.headHash,
        sequenceNumber: batch.eventCount,
      };
      const event: TraceEvent = {
        ...unhashed,
        id: uuidv4(),
        tenantId: batch.tenantId,
        hashVersion: CURRENT_HASH_VERSION,
        salt,
        hash: computeEventHashV2(unhashed, salt),
      };
      await this.repos.eventRepo.create(event);

      const allEvents = await this.repos.eventRepo.findByBatchId(batch.id);
      const detected = detectNewAnomalies(allEvents);
      const stored: Anomaly[] = [];
      for (const anomaly of detected) {
        stored.push(await this.repos.anomalyRepo.create({ ...anomaly, tenantId: batch.tenantId }));
      }

      if (isAdvancing) {
        await this.repos.batchRepo.advanceStage(batch.id, dto.stage, nextAssignee);
      }

      await this.audit(actor, 'EVENT_RECORDED', 'trace_event', event.id, { batchId: batch.id, stage: dto.stage });

      const recipients =
        stored.length > 0
          ? getInvolvedActorIds(allEvents, { createdBy: batch.createdBy, assignedToActorId: nextAssignee ?? undefined })
          : [];
      return { event, newAnomalies: stored, recipients };
    });

    for (const anomaly of newAnomalies) this.realtime?.emitAnomaly(anomaly, recipients);
    return event;
  }

  async recallBatch(actor: Actor, id: string, reason: string): Promise<Batch> {
    const { batch, recipients } = await this.db.withTenant(actor.tenantId, async () => {
      const recalled = await this.repos.batchRepo.markRecalled(id, reason);
      if (!recalled) {
        const existing = await this.repos.batchRepo.findById(id);
        if (!existing || existing.tenantId !== actor.tenantId) throw new NotFoundError('Batch not found');
        throw new ConflictError('Batch has already been recalled');
      }

      await this.audit(actor, 'BATCH_RECALLED', 'batch', recalled.id, { reason });

      const events = await this.repos.eventRepo.findByBatchId(recalled.id);
      return { batch: recalled, recipients: getInvolvedActorIds(events, recalled) };
    });

    this.realtime?.emitRecall(batch, recipients);
    return batch;
  }

  private async audit(
    actor: Actor,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.repos.auditLogRepo.create({
      id: uuidv4(),
      actorId: actor.id,
      tenantId: actor.tenantId,
      action,
      entityType,
      entityId,
      metadata,
      createdAt: new Date(),
    });
  }
}
