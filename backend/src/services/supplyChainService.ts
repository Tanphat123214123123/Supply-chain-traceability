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
import { sealEventV3 } from '../ledger/hashChain';
import { BatchExportFilters, IActorRepo, IAnomalyRepo, IAuditLogRepo, IBatchRepo, IEventRepo } from '../repository/interfaces';
import { PostgresLineageRepo, toKg } from '../repository/postgres/lineageRepo';
import { PostgresPlotRepo } from '../repository/postgres/plotRepo';
import { detectNewAnomalies } from './anomalyDetector';
import { resolveNextAssignee } from './custody';
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
  plotRepo: PostgresPlotRepo;
  lineageRepo: PostgresLineageRepo;
}

export class SupplyChainService {
  constructor(
    private readonly db: Database,
    private readonly repos: SupplyChainRepos,
    private readonly realtime?: RealtimeEmitter,
  ) {}

  async createBatch(actor: Actor, dto: CreateBatchDTO): Promise<Batch> {
    return this.db.withTenant(actor.tenantId, async () => {
      if (dto.plotId) {
        const plot = await this.repos.plotRepo.findById(dto.plotId);
        if (!plot || plot.tenantId !== actor.tenantId) throw new NotFoundError('Plot not found');
        if (actor.role !== 'ADMIN' && plot.ownerActorId !== actor.id) throw new ForbiddenError('This plot is not yours');
      }
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
        plotId: dto.plotId,
      });
      await this.audit(actor, 'BATCH_CREATED', 'batch', batch.id, { productName: batch.productName, plotId: dto.plotId });
      if (dto.plotId) await this.checkPlotYield(batch, dto.plotId);
      return batch;
    });
  }

  /**
   * SPEC §5 level 2: everything harvested from one plot in the last 365 days
   * can't exceed its area × the product's yield cap ("a 2 ha garden selling 30 t").
   */
  private async checkPlotYield(batch: Batch, plotId: string): Promise<void> {
    const [plot, cap] = await Promise.all([
      this.repos.plotRepo.findById(plotId),
      this.repos.lineageRepo.yieldCap(batch.productType),
    ]);
    if (!plot || cap === null) return;
    const harvests = await this.repos.lineageRepo.plotHarvests(plotId, batch.createdAt);
    let totalKg = 0;
    for (const h of harvests.filter((x) => x.productType === batch.productType)) {
      const kg = toKg(h.quantity, h.unit);
      if (kg === null) return; // count units can't be weighed
      totalKg += kg;
    }
    const limitKg = plot.areaHa * cap;
    if (totalKg <= limitKg) return;
    const anomaly = await this.repos.anomalyRepo.create({
      id: uuidv4(),
      type: 'MASS_BALANCE_VIOLATION',
      severity: 'HIGH',
      message: `Cân bằng khối lượng: lô đất ${plot.code} (${plot.areaHa} ha) đã khai ${totalKg.toLocaleString('vi-VN')} kg ${batch.productType} trong 12 tháng, vượt năng suất tối đa ${limitKg.toLocaleString('vi-VN')} kg`,
      batchId: batch.id,
      tenantId: batch.tenantId,
      detectedAt: new Date(),
      resolved: false,
    });
    this.realtime?.emitAnomaly(anomaly, [batch.createdBy]);
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

  /** Lots this actor can use as inputs to a merge/split/transform. */
  async listInCustody(actor: Actor): Promise<Batch[]> {
    return this.db.withTenant(actor.tenantId, () =>
      this.repos.batchRepo.findInCustody(actor.tenantId, actor.id, actor.role === 'ADMIN'),
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
      if (batch.consumedQuantity >= batch.quantity) {
        throw new ConflictError('Batch has been fully consumed by a merge, split or transformation');
      }
      this.assertCustody(actor, batch);

      const newIndex = STAGE_ORDER.indexOf(dto.stage);
      const currentIndex = batch.currentStage ? STAGE_ORDER.indexOf(batch.currentStage) : -1;
      const isAdvancing = newIndex > currentIndex;
      // Resolve (and validate) the hand-off BEFORE writing anything.
      const nextAssignee = isAdvancing
        ? await resolveNextAssignee(this.repos.actorRepo, actor, newIndex, dto.assignNextTo)
        : (batch.assignedToActorId ?? null);

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
        kind: 'OBSERVE' as const,
        links: [],
      };
      const { hash, claimSalts } = sealEventV3(unhashed);
      const event: TraceEvent = { ...unhashed, id: uuidv4(), tenantId: batch.tenantId, hashVersion: 3, claimSalts, hash };
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

  /**
   * Hands a lot over without recording a stage — e.g. the mill kept the green
   * beans after a transformation and now passes them to QC. Only the current
   * custodian (or ADMIN) may, and only to someone who works the lot's next
   * stage. Custody is bookkeeping, not ledger data, so it's audited rather
   * than hash-chained.
   */
  async handOff(actor: Actor, id: string, toActorId: string): Promise<Batch> {
    return this.db.withTenant(actor.tenantId, async () => {
      const batch = await this.repos.batchRepo.findByIdForUpdate(id);
      if (!batch || batch.tenantId !== actor.tenantId) throw new NotFoundError('Batch not found');
      if (batch.isRecalled) throw new ConflictError('Batch has been recalled — no further events allowed');
      if (batch.consumedQuantity >= batch.quantity) {
        throw new ConflictError('Batch has been fully consumed by a merge, split or transformation');
      }
      this.assertCustody(actor, batch);
      const currentIndex = batch.currentStage ? STAGE_ORDER.indexOf(batch.currentStage) : -1;
      if (currentIndex === STAGE_ORDER.length - 1) throw new ConflictError('Batch has completed its journey');
      const next = await resolveNextAssignee(this.repos.actorRepo, actor, currentIndex, toActorId);
      await this.repos.batchRepo.reassign(batch.id, next!);
      await this.audit(actor, 'BATCH_HANDED_OFF', 'batch', batch.id, { from: batch.assignedToActorId ?? null, to: next });
      return (await this.repos.batchRepo.findById(batch.id))!;
    });
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
