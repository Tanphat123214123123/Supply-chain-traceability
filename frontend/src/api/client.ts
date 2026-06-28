import axios from 'axios'

const BASE_URL = (import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_API_URL ?? '/api'

const client = axios.create({ baseURL: BASE_URL })

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

client.interceptors.response.use(
  (res) => res,
  (err: { response?: { status?: number } }) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('actor')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)

export default client

// ── Domain types (mirror backend) ────────────────────────────────────────────

export type ActorRole = 'FARMER' | 'PROCESSOR' | 'INSPECTOR' | 'DISTRIBUTOR' | 'RETAILER' | 'ADMIN'

export type SupplyChainStage =
  | 'HARVEST'
  | 'PROCESSING'
  | 'QUALITY_CHECK'
  | 'PACKAGING'
  | 'DISTRIBUTION'
  | 'RETAIL'

export const STAGE_ORDER: SupplyChainStage[] = [
  'HARVEST', 'PROCESSING', 'QUALITY_CHECK', 'PACKAGING', 'DISTRIBUTION', 'RETAIL',
]

export const STAGE_LABELS: Record<SupplyChainStage, string> = {
  HARVEST: 'Thu hoạch',
  PROCESSING: 'Chế biến',
  QUALITY_CHECK: 'Kiểm định chất lượng',
  PACKAGING: 'Đóng gói',
  DISTRIBUTION: 'Phân phối',
  RETAIL: 'Bán lẻ',
}

export const STAGE_ICONS: Record<SupplyChainStage, string> = {
  HARVEST: '🌱',
  PROCESSING: '🏭',
  QUALITY_CHECK: '🔬',
  PACKAGING: '📦',
  DISTRIBUTION: '🚛',
  RETAIL: '🏪',
}

export const ROLE_LABELS: Record<ActorRole, string> = {
  FARMER: 'Nông dân',
  PROCESSOR: 'Nhà chế biến',
  INSPECTOR: 'Kiểm định viên',
  DISTRIBUTOR: 'Nhà phân phối',
  RETAILER: 'Nhà bán lẻ',
  ADMIN: 'Quản trị viên',
}

export const ROLE_STAGES: Record<ActorRole, SupplyChainStage[]> = {
  FARMER: ['HARVEST'],
  PROCESSOR: ['PROCESSING', 'PACKAGING'],
  INSPECTOR: ['QUALITY_CHECK'],
  DISTRIBUTOR: ['DISTRIBUTION'],
  RETAILER: ['RETAIL'],
  ADMIN: ['HARVEST', 'PROCESSING', 'QUALITY_CHECK', 'PACKAGING', 'DISTRIBUTION', 'RETAIL'],
}

export interface Actor {
  id: string
  name: string
  role: ActorRole
  email: string
  organization: string
  createdAt: string
  isActive: boolean
}

export interface Batch {
  id: string
  productName: string
  productType: string
  origin: string
  quantity: number
  unit: string
  createdAt: string
  createdBy: string
  currentStage: SupplyChainStage | null
  isRecalled: boolean
  recallReason?: string
  metadata: Record<string, unknown>
}

export interface TraceEvent {
  id: string
  batchId: string
  stage: SupplyChainStage
  actorId: string
  timestamp: string
  location: string
  notes?: string
  data: Record<string, unknown>
  hash: string
  prevHash: string
  sequenceNumber: number
}

export interface Anomaly {
  type: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  message: string
  batchId: string
  eventId?: string
  detectedAt: string
}

export interface TraceResult {
  batch: Batch
  events: TraceEvent[]
  anomalies: Anomaly[]
  isValid: boolean
}

export interface PublicTrace {
  batch: Pick<Batch, 'id' | 'productName' | 'productType' | 'origin' | 'currentStage' | 'isRecalled' | 'recallReason'>
  stageCount: number
  isValid: boolean
  hasAnomalies: boolean
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    client.post<{ token: string; actor: Actor }>('/auth/login', { email, password }).then((r) => r.data),

  register: (body: {
    name: string
    email: string
    password: string
    role: ActorRole
    organization: string
  }) => client.post<Actor>('/auth/register', body).then((r) => r.data),
}

export const batchApi = {
  list: () => client.get<Batch[]>('/batches').then((r) => r.data),
  get: (id: string) => client.get<Batch>(`/batches/${id}`).then((r) => r.data),
  create: (body: {
    productName: string
    productType: string
    origin: string
    quantity: number
    unit: string
    metadata?: Record<string, unknown>
  }) => client.post<Batch>('/batches', body).then((r) => r.data),
  recall: (id: string, reason: string) =>
    client.post<Batch>(`/batches/${id}/recall`, { reason }).then((r) => r.data),
}

export const eventApi = {
  record: (body: {
    batchId: string
    stage: SupplyChainStage
    location: string
    notes?: string
    data?: Record<string, unknown>
  }) => client.post<TraceEvent>('/events', body).then((r) => r.data),
}

export const traceApi = {
  forward: (batchId: string) =>
    client.get<TraceResult>(`/trace/${batchId}`).then((r) => r.data),
  backward: (batchId: string) =>
    client.get<TraceResult>(`/trace/${batchId}?direction=backward`).then((r) => r.data),
  public: (batchId: string) =>
    client.get<PublicTrace>(`/trace/public/${batchId}`).then((r) => r.data),
}
