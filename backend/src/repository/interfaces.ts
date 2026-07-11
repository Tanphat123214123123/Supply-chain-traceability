import {
  Actor,
  Anomaly,
  AnomalyListQuery,
  AuditLogEntry,
  Batch,
  BatchListQuery,
  PaginatedResult,
  RefreshTokenRecord,
  SupplyChainStage,
  Tenant,
  TraceEvent,
} from '../domain/types';

export interface ITenantRepo {
  create(tenant: Tenant): Promise<Tenant>;
  findById(id: string): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
}

export interface IActorRepo {
  create(actor: Actor): Promise<Actor>;
  findById(id: string): Promise<Actor | null>;
  findByEmail(email: string): Promise<Actor | null>;
  findAllByTenant(tenantId: string): Promise<Actor[]>;
  update(actor: Actor): Promise<Actor>;
}

export interface IBatchRepo {
  create(batch: Batch): Promise<Batch>;
  findById(id: string): Promise<Batch | null>;
  /** Unscoped — for internal/system jobs only (e.g. startup integrity scan). Actor-facing code must use the `*ByTenant` variants. */
  findAll(): Promise<Batch[]>;
  findAllByTenant(tenantId: string): Promise<Batch[]>;
  findPageByTenant(tenantId: string, query: BatchListQuery): Promise<PaginatedResult<Batch>>;
  update(batch: Batch): Promise<Batch>;
}

export interface IEventRepo {
  create(event: TraceEvent): Promise<TraceEvent>;
  findByBatchId(batchId: string): Promise<TraceEvent[]>;
  findByActorId(actorId: string): Promise<TraceEvent[]>;
  countAll(): Promise<number>;
  /** The most recently recorded event for a batch, or null if it has none yet. */
  lastEvent(batchId: string): Promise<Pick<TraceEvent, 'sequenceNumber' | 'hash'> | null>;
  /** Event counts grouped by stage across ALL batches, in one query — powers the stats dashboard without an N+1 per-batch scan. */
  countByStage(): Promise<Partial<Record<SupplyChainStage, number>>>;
  /** Same as `countAll`, scoped to a specific tenant's batches (events carry no tenant_id of their own). */
  countAllForBatchIds(batchIds: string[]): Promise<number>;
  /** Same as `countByStage`, scoped to a specific tenant's batches. */
  countByStageForBatchIds(batchIds: string[]): Promise<Partial<Record<SupplyChainStage, number>>>;
}

export interface IAnomalyRepo {
  create(anomaly: Anomaly): Promise<Anomaly>;
  findById(id: string): Promise<Anomaly | null>;
  findByBatchId(batchId: string): Promise<Anomaly[]>;
  findPageByTenant(tenantId: string, query: AnomalyListQuery): Promise<PaginatedResult<Anomaly>>;
  resolve(id: string, resolvedBy: string): Promise<Anomaly | null>;
  countAllByTenant(tenantId: string): Promise<number>;
  /** Every anomaly for a tenant, unpaginated — for bulk aggregation (e.g. stats grouped by batch origin) in one query instead of one per batch. */
  findAllByTenant(tenantId: string): Promise<Anomaly[]>;
}

export interface IAuditLogRepo {
  create(entry: AuditLogEntry): Promise<AuditLogEntry>;
  findPageByTenant(tenantId: string, page: number, pageSize: number): Promise<PaginatedResult<AuditLogEntry>>;
  findByActionAndTenant(action: string, tenantId: string, limit: number): Promise<AuditLogEntry[]>;
}

export interface IRefreshTokenRepo {
  create(record: RefreshTokenRecord): Promise<RefreshTokenRecord>;
  findByToken(token: string): Promise<RefreshTokenRecord | null>;
  findActiveByActorId(actorId: string): Promise<RefreshTokenRecord[]>;
  revoke(token: string): Promise<void>;
}
