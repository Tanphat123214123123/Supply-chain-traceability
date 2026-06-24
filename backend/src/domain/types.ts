export enum SupplyChainStage {
  HARVEST = 'HARVEST',
  PROCESSING = 'PROCESSING',
  QUALITY_CHECK = 'QUALITY_CHECK',
  PACKAGING = 'PACKAGING',
  DISTRIBUTION = 'DISTRIBUTION',
  RETAIL = 'RETAIL',
}

export enum ActorRole {
  FARMER = 'FARMER',
  PROCESSOR = 'PROCESSOR',
  INSPECTOR = 'INSPECTOR',
  DISTRIBUTOR = 'DISTRIBUTOR',
  RETAILER = 'RETAILER',
  ADMIN = 'ADMIN',
}

export const STAGE_ORDER: SupplyChainStage[] = [
  SupplyChainStage.HARVEST,
  SupplyChainStage.PROCESSING,
  SupplyChainStage.QUALITY_CHECK,
  SupplyChainStage.PACKAGING,
  SupplyChainStage.DISTRIBUTION,
  SupplyChainStage.RETAIL,
];

export const ROLE_STAGE_PERMISSIONS: Record<ActorRole, SupplyChainStage[]> = {
  [ActorRole.FARMER]: [SupplyChainStage.HARVEST],
  [ActorRole.PROCESSOR]: [SupplyChainStage.PROCESSING, SupplyChainStage.PACKAGING],
  [ActorRole.INSPECTOR]: [SupplyChainStage.QUALITY_CHECK],
  [ActorRole.DISTRIBUTOR]: [SupplyChainStage.DISTRIBUTION],
  [ActorRole.RETAILER]: [SupplyChainStage.RETAIL],
  [ActorRole.ADMIN]: Object.values(SupplyChainStage),
};

export interface Actor {
  id: string;
  name: string;
  role: ActorRole;
  email: string;
  passwordHash: string;
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

export type AnomalyType =
  | 'STAGE_OUT_OF_ORDER'
  | 'DUPLICATE_STAGE'
  | 'UNAUTHORIZED_STAGE'
  | 'BATCH_RECALLED'
  | 'HASH_TAMPERED';

export type AnomalySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Anomaly {
  type: AnomalyType;
  severity: AnomalySeverity;
  message: string;
  batchId: string;
  eventId?: string;
  detectedAt: Date;
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

export interface LoginDTO {
  email: string;
  password: string;
}

export interface TraceResult {
  batch: Batch;
  events: TraceEvent[];
  anomalies: Anomaly[];
  isValid: boolean;
}
