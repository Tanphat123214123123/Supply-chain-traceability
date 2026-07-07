import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import {
  Actor,
  Anomaly,
  Batch,
  CreateBatchDTO,
  RecordEventDTO,
  ROLE_STAGES,
  STAGE_ORDER,
  TraceEvent,
} from '../domain/types';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { computeEventHash, GENESIS_HASH } from '../ledger/hashChain';
import { IActorRepo, IAnomalyRepo, IAuditLogRepo, IBatchRepo, IEventRepo } from '../repository/interfaces';
import { detectNewAnomalies } from './anomalyDetector';
import { getInvolvedActorIds } from './notificationScope';

export { ConflictError, ForbiddenError, NotFoundError };

export interface RealtimeEmitter {
  emitAnomaly(anomaly: Anomaly, recipientActorIds: string[]): void;
  emitRecall(batch: Batch, recipientActorIds: string[]): void;
}

export class SupplyChainService {
  // Serializes recordEvent calls per batchId within THIS process so two concurrent
  // requests can't both read the same sequenceNumber/prevHash and fork the chain.
  // Only sufficient for a single backend instance — see recordEventPostgres for the
  // cross-instance-safe path used when a Postgres pool is configured.
  private readonly batchQueues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly batchRepo: IBatchRepo,
    private readonly eventRepo: IEventRepo,
    private readonly anomalyRepo: IAnomalyRepo,
    private readonly auditLogRepo: IAuditLogRepo,
    private readonly actorRepo: IActorRepo,
    private readonly signingKey: string,
    private readonly pgPool?: Pool,
    private readonly realtime?: RealtimeEmitter,
  ) {}

  private runExclusive<T>(batchId: string, fn: () => Promise<T>): Promise<T> {
    const tail = this.batchQueues.get(batchId) ?? Promise.resolve();
    const result = tail.then(fn, fn);
    this.batchQueues.set(
      batchId,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }

  async createBatch(actor: Actor, dto: CreateBatchDTO): Promise<Batch> {
    const batch: Batch = {
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
    };
    await this.batchRepo.create(batch);
    await this.auditLogRepo.create({
      id: uuidv4(),
      actorId: actor.id,
      tenantId: actor.tenantId,
      action: 'BATCH_CREATED',
      entityType: 'batch',
      entityId: batch.id,
      metadata: { productName: batch.productName },
      createdAt: new Date(),
    });
    return batch;
  }

  async listBatches(actor: Actor): Promise<Batch[]> {
    return this.batchRepo.findAllByTenant(actor.tenantId);
  }

  /** System-wide check (not tenant-scoped) — only for the bootstrap idempotency check in sampleData.ts. */
  async hasAnyBatches(): Promise<boolean> {
    const all = await this.batchRepo.findAll();
    return all.length > 0;
  }

  async listBatchesPage(actor: Actor, query: { page: number; pageSize: number; search?: string }) {
    return this.batchRepo.findPageByTenant(actor.tenantId, query);
  }

  /**
   * Non-recalled batches whose next stage this actor's role can record AND
   * that are actually theirs to act on — either explicitly assigned to them,
   * unclaimed (legacy data / an admin left it open), or any batch at all if
   * they're an ADMIN. A "my work queue" view.
   */
  async listPendingForActor(actor: Actor): Promise<Batch[]> {
    const allowedStages = ROLE_STAGES[actor.role];
    const all = await this.batchRepo.findAllByTenant(actor.tenantId);
    return all.filter((batch) => {
      if (batch.isRecalled) return false;
      const currentIndex = batch.currentStage ? STAGE_ORDER.indexOf(batch.currentStage) : -1;
      const nextIndex = currentIndex + 1;
      if (nextIndex >= STAGE_ORDER.length) return false;
      if (!allowedStages.includes(STAGE_ORDER[nextIndex])) return false;
      if (actor.role === 'ADMIN') return true;
      return batch.assignedToActorId == null || batch.assignedToActorId === actor.id;
    });
  }

  /** Batches filtered by creation date range and/or origin, for compliance/reporting export. */
  async exportBatches(actor: Actor, filters: { from?: Date; to?: Date; origin?: string }): Promise<Batch[]> {
    const all = await this.batchRepo.findAllByTenant(actor.tenantId);
    return all.filter((b) => {
      if (filters.from && b.createdAt < filters.from) return false;
      if (filters.to && b.createdAt > filters.to) return false;
      if (filters.origin && !b.origin.toLowerCase().includes(filters.origin.toLowerCase())) return false;
      return true;
    });
  }

  async getBatch(actor: Actor, id: string): Promise<Batch> {
    const batch = await this.batchRepo.findById(id);
    // Same NotFoundError for "doesn't exist" and "exists but belongs to
    // another tenant" — a 403 would confirm the batch exists to someone
    // who has no business knowing that.
    if (!batch || batch.tenantId !== actor.tenantId) throw new NotFoundError('Batch not found');
    return batch;
  }

  async recordEvent(actor: Actor, dto: RecordEventDTO): Promise<TraceEvent> {
    const allowedStages = ROLE_STAGES[actor.role];
    if (!allowedStages.includes(dto.stage)) {
      throw new ForbiddenError(`Role ${actor.role} is not permitted to record stage ${dto.stage}`);
    }

    if (this.pgPool) {
      return this.recordEventPostgres(actor, dto);
    }

    return this.runExclusive(dto.batchId, () => this.recordEventInner(actor, dto));
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
   * should become the batch's new custodian — undefined if the chain is
   * complete (terminal stage) or an ADMIN deliberately left it unclaimed.
   * Only called when `newStageIndex` is a genuine forward advance, so a
   * backfilled/duplicate stage recording never disturbs the current hand-off.
   */
  private async resolveNextAssignee(
    actor: Actor,
    newStageIndex: number,
    assignNextTo: string | undefined,
  ): Promise<string | undefined> {
    const isTerminal = newStageIndex === STAGE_ORDER.length - 1;
    if (isTerminal) return undefined;

    if (!assignNextTo) {
      if (actor.role === 'ADMIN') return undefined;
      throw new ConflictError('You must designate who handles the next stage before completing this one');
    }

    const nextActor = await this.actorRepo.findById(assignNextTo);
    if (!nextActor || nextActor.tenantId !== actor.tenantId) throw new NotFoundError('Assigned actor not found');
    if (!nextActor.isActive) throw new ConflictError('Assigned actor account is inactive');

    const nextStage = STAGE_ORDER[newStageIndex + 1];
    if (!ROLE_STAGES[nextActor.role].includes(nextStage)) {
      throw new ConflictError(`${nextActor.role} cannot handle stage ${nextStage}`);
    }

    return assignNextTo;
  }

  /** Single-process-safe path (in-memory repos, or Postgres without cross-instance safety needs). */
  private async recordEventInner(actor: Actor, dto: RecordEventDTO): Promise<TraceEvent> {
    const batch = await this.batchRepo.findById(dto.batchId);
    // Same tenant check regardless of role — ADMIN is scoped to its own
    // tenant, not a cross-tenant platform role, and assertCustody below
    // deliberately lets ADMIN bypass the custody check, so this must come first.
    if (!batch || batch.tenantId !== actor.tenantId) throw new NotFoundError('Batch not found');
    if (batch.isRecalled) throw new ConflictError('Batch has been recalled — no further events allowed');
    this.assertCustody(actor, batch);

    const newIndex = STAGE_ORDER.indexOf(dto.stage);
    const currentIndex = batch.currentStage ? STAGE_ORDER.indexOf(batch.currentStage) : -1;
    const isAdvancing = newIndex > currentIndex;
    // Resolve (and validate) the hand-off BEFORE writing anything, so a bad
    // assignNextTo can't leave an event persisted with no reachable next actor.
    const nextAssignee = isAdvancing
      ? await this.resolveNextAssignee(actor, newIndex, dto.assignNextTo)
      : batch.assignedToActorId;

    const last = await this.eventRepo.lastEvent(dto.batchId);
    const sequenceNumber = last ? last.sequenceNumber + 1 : 0;
    const prevHash = last ? last.hash : GENESIS_HASH;

    const unhashed = {
      batchId: dto.batchId,
      stage: dto.stage,
      actorId: actor.id,
      timestamp: new Date(),
      location: dto.location,
      notes: dto.notes,
      data: dto.data ?? {},
      prevHash,
      sequenceNumber,
    };

    const event: TraceEvent = { ...unhashed, id: uuidv4(), hash: computeEventHash(unhashed, this.signingKey) };
    await this.eventRepo.create(event);

    const allEvents = await this.eventRepo.findByBatchId(dto.batchId);
    const newAnomalies = detectNewAnomalies(allEvents);
    if (newAnomalies.length > 0) {
      const recipientActorIds = getInvolvedActorIds(allEvents, batch);
      for (const anomaly of newAnomalies) {
        const stored = await this.anomalyRepo.create({ ...anomaly, tenantId: batch.tenantId });
        this.realtime?.emitAnomaly(stored, recipientActorIds);
      }
    }

    if (isAdvancing) {
      batch.currentStage = dto.stage;
      batch.assignedToActorId = nextAssignee;
      await this.batchRepo.update(batch);
    }

    await this.auditLogRepo.create({
      id: uuidv4(),
      actorId: actor.id,
      tenantId: actor.tenantId,
      action: 'EVENT_RECORDED',
      entityType: 'trace_event',
      entityId: event.id,
      metadata: { batchId: dto.batchId, stage: dto.stage },
      createdAt: new Date(),
    });

    return event;
  }

  /**
   * Cross-instance-safe path: locks the batch row for the duration of a single
   * DB transaction, so two backend replicas racing on the same batch can't both
   * compute the same sequenceNumber/prevHash. Uses raw SQL directly against the
   * transaction's own client rather than the shared repo interfaces, since those
   * borrow a connection from the pool per call and can't share one transaction.
   */
  private async recordEventPostgres(actor: Actor, dto: RecordEventDTO): Promise<TraceEvent> {
    const client = await this.pgPool!.connect();
    try {
      await client.query('BEGIN');

      const batchResult = await client.query(
        'SELECT id, current_stage, is_recalled, assigned_to_actor_id, created_by, tenant_id FROM batches WHERE id = $1 FOR UPDATE',
        [dto.batchId],
      );
      const batchRow = batchResult.rows[0] as
        | {
            id: string;
            current_stage: string | null;
            is_recalled: boolean;
            assigned_to_actor_id: string | null;
            created_by: string;
            tenant_id: string;
          }
        | undefined;
      // Same tenant check regardless of role — ADMIN is scoped to its own
      // tenant, not a cross-tenant platform role, and assertCustody below
      // deliberately lets ADMIN bypass the custody check, so this must come first.
      if (!batchRow || batchRow.tenant_id !== actor.tenantId) throw new NotFoundError('Batch not found');
      if (batchRow.is_recalled) throw new ConflictError('Batch has been recalled — no further events allowed');
      this.assertCustody(actor, { assignedToActorId: batchRow.assigned_to_actor_id ?? undefined });

      const newIndex = STAGE_ORDER.indexOf(dto.stage);
      const currentIndex = batchRow.current_stage ? STAGE_ORDER.indexOf(batchRow.current_stage as TraceEvent['stage']) : -1;
      const isAdvancing = newIndex > currentIndex;
      let nextAssignee = batchRow.assigned_to_actor_id ?? undefined;
      if (isAdvancing) {
        const isTerminal = newIndex === STAGE_ORDER.length - 1;
        if (isTerminal) {
          nextAssignee = undefined;
        } else if (dto.assignNextTo) {
          const nextActorResult = await client.query(
            'SELECT role, is_active, tenant_id FROM actors WHERE id = $1',
            [dto.assignNextTo],
          );
          const nextActorRow = nextActorResult.rows[0] as
            | { role: Actor['role']; is_active: boolean; tenant_id: string }
            | undefined;
          if (!nextActorRow || nextActorRow.tenant_id !== actor.tenantId) throw new NotFoundError('Assigned actor not found');
          if (!nextActorRow.is_active) throw new ConflictError('Assigned actor account is inactive');
          const nextStage = STAGE_ORDER[newIndex + 1];
          if (!ROLE_STAGES[nextActorRow.role].includes(nextStage)) {
            throw new ConflictError(`${nextActorRow.role} cannot handle stage ${nextStage}`);
          }
          nextAssignee = dto.assignNextTo;
        } else if (actor.role === 'ADMIN') {
          nextAssignee = undefined;
        } else {
          throw new ConflictError('You must designate who handles the next stage before completing this one');
        }
      }

      const lastResult = await client.query(
        'SELECT sequence_number, hash FROM trace_events WHERE batch_id = $1 ORDER BY sequence_number DESC LIMIT 1',
        [dto.batchId],
      );
      const lastRow = lastResult.rows[0] as { sequence_number: number; hash: string } | undefined;
      const sequenceNumber = lastRow ? lastRow.sequence_number + 1 : 0;
      const prevHash = lastRow ? lastRow.hash : GENESIS_HASH;

      const unhashed = {
        batchId: dto.batchId,
        stage: dto.stage,
        actorId: actor.id,
        timestamp: new Date(),
        location: dto.location,
        notes: dto.notes,
        data: dto.data ?? {},
        prevHash,
        sequenceNumber,
      };
      const event: TraceEvent = { ...unhashed, id: uuidv4(), hash: computeEventHash(unhashed, this.signingKey) };

      await client.query(
        `INSERT INTO trace_events (id, batch_id, stage, actor_id, timestamp, location, notes, data, hash, prev_hash, sequence_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          event.id,
          event.batchId,
          event.stage,
          event.actorId,
          event.timestamp,
          event.location,
          event.notes ?? null,
          JSON.stringify(event.data ?? {}),
          event.hash,
          event.prevHash,
          event.sequenceNumber,
        ],
      );

      const allEventsResult = await client.query(
        'SELECT * FROM trace_events WHERE batch_id = $1 ORDER BY sequence_number ASC',
        [dto.batchId],
      );
      const allEvents: TraceEvent[] = allEventsResult.rows.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        batchId: row.batch_id as string,
        stage: row.stage as TraceEvent['stage'],
        actorId: row.actor_id as string,
        timestamp: row.timestamp as Date,
        location: row.location as string,
        notes: (row.notes as string | null) ?? undefined,
        data: row.data as Record<string, unknown>,
        hash: row.hash as string,
        prevHash: row.prev_hash as string,
        sequenceNumber: row.sequence_number as number,
      }));

      const newAnomalies = detectNewAnomalies(allEvents);
      for (const anomaly of newAnomalies) {
        await client.query(
          `INSERT INTO anomalies (id, batch_id, event_id, type, severity, message, detected_at, tenant_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            anomaly.id,
            anomaly.batchId,
            anomaly.eventId ?? null,
            anomaly.type,
            anomaly.severity,
            anomaly.message,
            anomaly.detectedAt,
            batchRow.tenant_id,
          ],
        );
      }

      if (isAdvancing) {
        await client.query('UPDATE batches SET current_stage = $2, assigned_to_actor_id = $3 WHERE id = $1', [
          dto.batchId,
          dto.stage,
          nextAssignee ?? null,
        ]);
      }

      await client.query(
        `INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata, created_at, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          uuidv4(),
          actor.id,
          'EVENT_RECORDED',
          'trace_event',
          event.id,
          JSON.stringify({ batchId: dto.batchId, stage: dto.stage }),
          new Date(),
          actor.tenantId,
        ],
      );

      await client.query('COMMIT');

      if (newAnomalies.length > 0) {
        const recipientActorIds = getInvolvedActorIds(allEvents, {
          createdBy: batchRow.created_by,
          assignedToActorId: nextAssignee ?? batchRow.assigned_to_actor_id ?? undefined,
        });
        for (const anomaly of newAnomalies) {
          this.realtime?.emitAnomaly({ ...anomaly, tenantId: batchRow.tenant_id }, recipientActorIds);
        }
      }

      return event;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async recallBatch(actor: Actor, id: string, reason: string): Promise<Batch> {
    const batch = await this.batchRepo.findById(id);
    if (!batch || batch.tenantId !== actor.tenantId) throw new NotFoundError('Batch not found');
    batch.isRecalled = true;
    batch.recallReason = reason;
    await this.batchRepo.update(batch);

    await this.auditLogRepo.create({
      id: uuidv4(),
      actorId: actor.id,
      tenantId: actor.tenantId,
      action: 'BATCH_RECALLED',
      entityType: 'batch',
      entityId: batch.id,
      metadata: { reason },
      createdAt: new Date(),
    });

    const events = await this.eventRepo.findByBatchId(batch.id);
    const recipientActorIds = getInvolvedActorIds(events, batch);
    this.realtime?.emitRecall(batch, recipientActorIds);
    return batch;
  }
}
