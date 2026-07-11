export type ActorRole = 'FARMER' | 'PROCESSOR' | 'INSPECTOR' | 'DISTRIBUTOR' | 'RETAILER' | 'ADMIN';

export type SupplyChainStage =
  | 'HARVEST'
  | 'PROCESSING'
  | 'QUALITY_CHECK'
  | 'PACKAGING'
  | 'DISTRIBUTION'
  | 'RETAIL';

export const STAGE_ORDER: SupplyChainStage[] = [
  'HARVEST',
  'PROCESSING',
  'QUALITY_CHECK',
  'PACKAGING',
  'DISTRIBUTION',
  'RETAIL',
];

export const ROLE_STAGES: Record<ActorRole, SupplyChainStage[]> = {
  FARMER: ['HARVEST'],
  PROCESSOR: ['PROCESSING', 'PACKAGING'],
  INSPECTOR: ['QUALITY_CHECK'],
  DISTRIBUTOR: ['DISTRIBUTION'],
  RETAILER: ['RETAIL'],
  ADMIN: ['HARVEST', 'PROCESSING', 'QUALITY_CHECK', 'PACKAGING', 'DISTRIBUTION', 'RETAIL'],
};

/**
 * A SaaS customer boundary — completely isolated from every other tenant.
 * NOT the same thing as `Actor.organization`: multiple organizations
 * (farmer co-op, processor, distributor...) belong to the SAME tenant and
 * legitimately collaborate on the same batch as custody passes between them.
 * Tenants must never see each other's actors/batches/stats.
 */
export interface Tenant {
  id: string;
  slug: string;
  name: string;
  createdAt: Date;
}

export interface Actor {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: ActorRole;
  organization: string;
  tenantId: string;
  createdAt: Date;
  isActive: boolean;
}

export interface Batch {
  id: string;
  productName: string;
  productType: string;
  origin: string;
  quantity: number;
  unit: string;
  createdAt: Date;
  createdBy: string;
  tenantId: string;
  currentStage: SupplyChainStage | null;
  isRecalled: boolean;
  recallReason?: string;
  metadata: Record<string, unknown>;
  /**
   * The one actor currently authorized to record the batch's next event —
   * the chain-of-custody hand-off. Set to the creator on `createBatch`, then
   * re-assigned by whoever completes each stage (see `RecordEventDTO.assignNextTo`).
   * `undefined` means unclaimed (legacy data, or an admin chose not to assign)
   * — falls back to "anyone with the right role" for that case.
   */
  assignedToActorId?: string;
}

export interface TraceEvent {
  id: string;
  batchId: string;
  stage: SupplyChainStage;
  actorId: string;
  timestamp: Date;
  location: string;
  notes?: string;
  data: Record<string, unknown>;
  hash: string;
  prevHash: string;
  sequenceNumber: number;
}

export type AnomalySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type AnomalyType = 'STAGE_SKIPPED' | 'DUPLICATE_STAGE' | 'OUT_OF_ORDER' | 'CHAIN_TAMPERED';

export interface Anomaly {
  id: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  message: string;
  batchId: string;
  tenantId: string;
  eventId?: string;
  detectedAt: Date;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: Date;
}

export interface TraceResult {
  batch: Batch;
  events: TraceEvent[];
  anomalies: Anomaly[];
  isValid: boolean;
}

export interface PublicTrace {
  batch: Pick<Batch, 'id' | 'productName' | 'productType' | 'origin' | 'currentStage' | 'isRecalled' | 'recallReason'>;
  stageCount: number;
  isValid: boolean;
  hasAnomalies: boolean;
}

export interface LoginDTO {
  email: string;
  password: string;
}

export interface RegisterDTO {
  name: string;
  email: string;
  password: string;
  role: ActorRole;
  organization: string;
  /** Workspace identifier (like a Slack workspace slug) — join if it exists, create if not. */
  tenantSlug: string;
  /** Only used when `tenantSlug` doesn't exist yet and a new tenant is created. */
  tenantName?: string;
}

export interface CreateBatchDTO {
  productName: string;
  productType: string;
  origin: string;
  quantity: number;
  unit: string;
  metadata?: Record<string, unknown>;
}

export interface RecordEventDTO {
  batchId: string;
  stage: SupplyChainStage;
  location: string;
  notes?: string;
  data?: Record<string, unknown>;
  /**
   * Who takes custody next (required for non-ADMIN actors when this event
   * isn't the terminal RETAIL stage) — must be an active actor whose role is
   * allowed to record the next stage in STAGE_ORDER.
   */
  assignNextTo?: string;
}

export interface StatsOverview {
  totalBatches: number;
  activeBatches: number;
  recalledBatches: number;
  totalEvents: number;
  anomalyCount: number;
}

export interface StatsByStage {
  stage: SupplyChainStage;
  count: number;
}

export interface StatsByDay {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface StatsByOrigin {
  origin: string;
  batchCount: number;
  anomalyCount: number;
}

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  tenantId: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BatchListQuery {
  page: number;
  pageSize: number;
  search?: string;
}

export interface RefreshTokenRecord {
  token: string;
  actorId: string;
  expiresAt: Date;
  revoked: boolean;
  createdAt: Date;
}

export interface AnomalyListQuery {
  page: number;
  pageSize: number;
  resolved?: boolean;
  severity?: AnomalySeverity;
}

export interface UpdateProfileDTO {
  name?: string;
  organization?: string;
}

export interface ChangePasswordDTO {
  currentPassword: string;
  newPassword: string;
}

/** A partner (organization) participating in the supply chain, derived from its actors. */
export interface PartnerSummary {
  organization: string;
  actorCount: number;
  roles: ActorRole[];
}

/** A single item in the combined realtime-alert history (anomaly detected or batch recalled). */
export interface NotificationItem {
  id: string;
  kind: 'ANOMALY' | 'RECALL';
  message: string;
  severity?: AnomalySeverity;
  batchId: string;
  createdAt: Date;
}
