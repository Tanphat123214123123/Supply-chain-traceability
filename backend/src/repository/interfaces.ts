import {
  Actor,
  ActorRole,
  Anomaly,
  AnomalyListQuery,
  AuditLogEntry,
  Batch,
  AttentionSummary,
  BatchListQuery,
  Invitation,
  InvitationPreview,
  PaginatedResult,
  RefreshTokenRecord,
  StatsByDay,
  StatsByOrigin,
  StatsOverview,
  SupplyChainStage,
  Tenant,
  TraceEvent,
} from '../domain/types';

/**
 * Every method that touches a tenant-owned table must run inside
 * `Database.withTenant(...)` — row-level security returns nothing otherwise.
 * Methods documented as "pre-tenant" go through SECURITY DEFINER functions
 * and are the only ones meant to be called without a tenant scope.
 */

export interface ITenantRepo {
  /** Inserts unless the slug is taken; returns null if another request created it first. */
  insertIfAbsent(tenant: Tenant): Promise<Tenant | null>;
  findById(id: string): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
  listIds(): Promise<string[]>;
}

export interface IInvitationRepo {
  create(invitation: Invitation, codeHash: string): Promise<Invitation>;
  /** Pre-tenant: the still-redeemable invitation behind a code digest, or null. */
  resolve(codeHash: string): Promise<InvitationPreview | null>;
  /** Locks the invitation row and returns it only while it is still redeemable. */
  findRedeemableForUpdate(id: string): Promise<Invitation | null>;
  markUsed(id: string, actorId: string): Promise<void>;
  /** Revokes a still-open invitation; null if it doesn't exist or was already used/revoked. */
  revoke(id: string): Promise<Invitation | null>;
  /** Newest first: open, used and revoked alike — the admin's full history. */
  findRecentByTenant(tenantId: string, limit: number): Promise<Invitation[]>;
}

export interface ActorIdentity {
  actorId: string;
  tenantId: string;
}

export interface IActorRepo {
  create(actor: Actor): Promise<Actor>;
  findById(id: string): Promise<Actor | null>;
  findAllByTenant(tenantId: string): Promise<Actor[]>;
  /** Pre-tenant: which actor/tenant owns this email (globally unique). */
  lookupByEmail(email: string): Promise<ActorIdentity | null>;
  updateProfile(id: string, changes: { name: string; organization: string }): Promise<Actor | null>;
  setActive(id: string, isActive: boolean): Promise<Actor | null>;
  setRole(id: string, role: ActorRole): Promise<Actor | null>;
  setPasswordHash(id: string, passwordHash: string): Promise<void>;
}

export interface BatchExportFilters {
  from?: Date;
  to?: Date;
  origin?: string;
}

/** A batch as the application creates it — the chain head starts at genesis and is owned by the database. */
export type NewBatch = Omit<Batch, 'headHash' | 'eventCount' | 'consumedQuantity'>;

export interface IBatchRepo {
  create(batch: NewBatch): Promise<Batch>;
  findById(id: string): Promise<Batch | null>;
  /** Many lots in one round-trip (lineage graphs can span hundreds). */
  findByIds(ids: string[]): Promise<Batch[]>;
  /** Same as findById but takes a row lock until the surrounding transaction ends. */
  findByIdForUpdate(id: string): Promise<Batch | null>;
  /** Pre-tenant: the tenant that owns a batch, for public QR/provenance lookups. */
  resolveTenantId(batchId: string): Promise<string | null>;
  hasAnyInTenant(tenantId: string): Promise<boolean>;
  findPageByTenant(tenantId: string, query: BatchListQuery): Promise<PaginatedResult<Batch>>;
  findForExport(tenantId: string, filters: BatchExportFilters): Promise<Batch[]>;
  /** Non-recalled batches whose NEXT stage is in `allowedStages` and that this actor may act on. */
  findPendingFor(tenantId: string, actorId: string, allowedStages: SupplyChainStage[], isAdmin: boolean): Promise<Batch[]>;
  /** Open lots (recorded, not recalled, not fully consumed) this actor holds — all open lots for ADMIN. */
  findInCustody(tenantId: string, actorId: string, isAdmin: boolean): Promise<Batch[]>;
  /** Batches the actor created, currently holds, or recorded any event on. */
  findInvolving(tenantId: string, actorId: string): Promise<Batch[]>;
  /** Keyset-paginated walk over a tenant's batches (for integrity scans). */
  findPageAfter(tenantId: string, afterId: string | null, limit: number): Promise<Batch[]>;
  advanceStage(id: string, stage: SupplyChainStage, assignedToActorId: string | null): Promise<void>;
  /** Changes custody only (no stage change). */
  reassign(id: string, assignedToActorId: string): Promise<void>;
  /** Atomically recalls a not-yet-recalled batch; null if it doesn't exist or was already recalled. */
  markRecalled(id: string, reason: string): Promise<Batch | null>;
}

export interface IEventRepo {
  create(event: TraceEvent): Promise<TraceEvent>;
  findByBatchId(batchId: string): Promise<TraceEvent[]>;
  /** Events of several batches, ordered by batch then sequence number. */
  findByBatchIds(batchIds: string[]): Promise<TraceEvent[]>;
}

export interface IAnomalyRepo {
  create(anomaly: Anomaly): Promise<Anomaly>;
  /** Insert unless an unresolved CHAIN_TAMPERED alert already exists for the batch (unique partial index). */
  createTamperAlertIfAbsent(anomaly: Anomaly): Promise<Anomaly | null>;
  findById(id: string): Promise<Anomaly | null>;
  findByBatchId(batchId: string): Promise<Anomaly[]>;
  findPageByTenant(tenantId: string, query: AnomalyListQuery): Promise<PaginatedResult<Anomaly>>;
  /** Resolves only if still unresolved; null otherwise (already resolved, or not found). */
  resolve(id: string, resolvedBy: string): Promise<Anomaly | null>;
  /** Most recent anomalies, optionally limited to batches `involvingActorId` is involved in. */
  findRecent(tenantId: string, limit: number, involvingActorId?: string): Promise<Anomaly[]>;
}

export interface IAuditLogRepo {
  create(entry: AuditLogEntry): Promise<AuditLogEntry>;
  findPageByTenant(tenantId: string, page: number, pageSize: number): Promise<PaginatedResult<AuditLogEntry>>;
  /** Most recent entries for one action on batches, optionally limited to batches `involvingActorId` is involved in. */
  findRecentBatchAction(tenantId: string, action: string, limit: number, involvingActorId?: string): Promise<AuditLogEntry[]>;
}

export interface IRefreshTokenRepo {
  create(record: RefreshTokenRecord): Promise<RefreshTokenRecord>;
  /** Pre-tenant, atomic: revokes a valid token and returns whose it was, or null if invalid/expired/already used. */
  consume(tokenHash: string): Promise<ActorIdentity | null>;
  /** Pre-tenant: revoke (logout). */
  revoke(tokenHash: string): Promise<void>;
  findActiveByActorId(actorId: string): Promise<RefreshTokenRecord[]>;
  revokeForActor(actorId: string, tokenHash: string): Promise<boolean>;
  /** Pre-tenant housekeeping: delete long-expired/revoked sessions. */
  purgeStale(): Promise<number>;
}

export interface IStatsRepo {
  overview(tenantId: string): Promise<StatsOverview>;
  eventCountByStage(tenantId: string): Promise<Partial<Record<SupplyChainStage, number>>>;
  batchesPerDay(tenantId: string, days: number): Promise<StatsByDay[]>;
  byOrigin(tenantId: string): Promise<StatsByOrigin[]>;
  /** Non-recalled, unfinished batches with no activity for `stalledAfterDays`, plus open anomaly count. */
  attention(tenantId: string, stalledAfterDays: number, limit: number): Promise<AttentionSummary>;
}
