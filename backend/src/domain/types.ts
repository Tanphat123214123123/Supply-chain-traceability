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

export interface Actor {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: ActorRole;
  organization: string;
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
  currentStage: SupplyChainStage | null;
  isRecalled: boolean;
  recallReason?: string;
  metadata: Record<string, unknown>;
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
  type: AnomalyType;
  severity: AnomalySeverity;
  message: string;
  batchId: string;
  eventId?: string;
  detectedAt: Date;
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
