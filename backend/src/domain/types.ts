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
  /**
   * Head of this batch's hash chain as recorded by the database — advanced
   * only by the ledger insert trigger (migration 007), never by the app.
   * Lets a verifier detect a truncated chain, not just an edited one.
   */
  headHash: string;
  eventCount: number;
  /** Timestamp of the most recent event, derived on read — undefined while no event exists yet. */
  lastEventAt?: Date;
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
  tenantId: string;
  hash: string;
  prevHash: string;
  sequenceNumber: number;
  /** 1 = legacy HMAC (server-verifiable only), 2 = public salted SHA-256 — see ledger/hashChain.ts. */
  hashVersion: 1 | 2;
  /** Per-event random salt, part of the v2 hash preimage. Absent on v1 events. */
  salt?: string;
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

/** One step of the consumer-facing journey: who (organization, never a person), where, when, and the publishable facts. */
export interface PublicJourneyStep {
  stage: SupplyChainStage;
  timestamp: Date;
  location: string;
  organization: string;
  /** Only the whitelisted keys of the event's `data` (see PUBLIC_EVENT_FIELDS). */
  details: Record<string, string | number | boolean>;
}

export interface PublicTrace {
  batch: Pick<Batch, 'id' | 'productName' | 'productType' | 'origin' | 'currentStage' | 'isRecalled' | 'recallReason'>;
  stageCount: number;
  isValid: boolean;
  hasAnomalies: boolean;
  journey: PublicJourneyStep[];
}

/**
 * Event `data` keys that may appear on the public provenance page, per stage.
 * Everything else an actor records (internal moisture readings, vehicle
 * plates, package counts...) stays visible only inside the tenant.
 * Mirrors the `public: true` flags in frontend/src/domain/stageFields.ts.
 */
export const PUBLIC_EVENT_FIELDS: Record<SupplyChainStage, string[]> = {
  HARVEST: ['harvestDate', 'variety', 'cultivation'],
  PROCESSING: ['method'],
  QUALITY_CHECK: ['result', 'grade', 'certificateNo'],
  PACKAGING: ['packageType', 'expiryDate'],
  DISTRIBUTION: ['destination'],
  RETAIL: ['storeName', 'shelfDate'],
};

/** A batch counts as stalled when nothing has happened to it for this long. */
export const STALLED_AFTER_DAYS = 3;

export interface AttentionSummary {
  /** Oldest-first: the batches that have waited longest come first. */
  stalledBatches: Batch[];
  stalledCount: number;
  openAnomalyCount: number;
}

export interface Invitation {
  id: string;
  tenantId: string;
  role: ActorRole;
  email?: string;
  note?: string;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt?: Date;
  usedBy?: string;
  revokedAt?: Date;
}

/** What a registrant may learn about an invitation from its code alone. */
export interface InvitationPreview {
  invitationId: string;
  tenantId: string;
  tenantName: string;
  role: ActorRole;
  email?: string;
  expiresAt: Date;
}

export interface LoginDTO {
  email: string;
  password: string;
}

interface RegisterBase {
  name: string;
  email: string;
  password: string;
  organization: string;
}

/** Founds a brand-new workspace; the registrant becomes its first ADMIN. */
export interface RegisterWorkspaceDTO extends RegisterBase {
  tenantSlug: string;
  tenantName: string;
}

/** Joins an existing workspace; the role comes from the invitation, not the registrant. */
export interface RegisterWithInviteDTO extends RegisterBase {
  inviteCode: string;
}

export interface CreateInvitationDTO {
  role: ActorRole;
  email?: string;
  note?: string;
  expiresInDays: number;
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
  openAnomalyCount: number;
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
  /** A stage, or 'NONE' for batches with no event yet. */
  stage?: SupplyChainStage | 'NONE';
}

export interface RefreshTokenRecord {
  /** SHA-256 of the raw token — the raw value is never stored. */
  token: string;
  actorId: string;
  tenantId: string;
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
