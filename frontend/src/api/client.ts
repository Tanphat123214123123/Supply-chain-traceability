import axios from 'axios'
import { io, Socket } from 'socket.io-client'
import { Sprout, Factory, Microscope, Package, Truck, Store, type LucideIcon } from 'lucide-react'

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

// The refresh token now lives only in an httpOnly cookie set by the backend
// (never readable by JS, so an XSS bug can't exfiltrate it). The access token
// is kept in memory only — never persisted — so it doesn't survive a reload
// either; AuthContext re-derives it on mount by calling authApi.refresh(),
// which succeeds automatically as long as the httpOnly cookie is still valid.
let accessToken: string | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

const client = axios.create({ baseURL: BASE_URL, withCredentials: true })

client.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`
  return config
})

// ── Silent-refresh on access-token expiry ────────────────────────────────────
// Concurrent 401s while a refresh is already in flight all wait on the same
// promise instead of each firing their own /auth/refresh call — this also
// covers AuthContext's mount-time session restore racing a 401-triggered
// retry, so a rotated refresh token is never raced against by two callers.
//
// Deliberately uses raw `axios`, NOT the intercepted `client` instance: this
// call itself 401s on every anonymous page load (no session yet), and if that
// went through `client`, the response interceptor below would treat it as a
// failed refresh and hard-redirect to /login — which remounts AuthContext,
// which calls this again, which 401s again... an infinite reload loop on
// every single visit, logged in or not.
let refreshPromise: Promise<{ token: string; actor: Actor }> | null = null

async function performRefresh(): Promise<{ token: string; actor: Actor }> {
  const { data } = await axios.post<{ token: string; actor: Actor }>(
    `${BASE_URL}/auth/refresh`,
    {},
    { withCredentials: true },
  )
  setAccessToken(data.token)
  localStorage.setItem('actor', JSON.stringify(data.actor))
  return data
}

function silentRefresh(): Promise<{ token: string; actor: Actor }> {
  refreshPromise ??= performRefresh().finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

function logoutAndRedirect() {
  setAccessToken(null)
  localStorage.removeItem('actor')
  window.location.href = '/login'
}

client.interceptors.response.use(
  (res) => res,
  async (err: {
    config?: { url?: string; headers?: Record<string, string>; _retry?: boolean }
    response?: { status?: number }
  }) => {
    const config = err.config
    const url = config?.url ?? ''
    // A 401 from the login call itself means "wrong credentials", not "session
    // expired" — that should surface as an inline form error, not a redirect.
    const isLoginRequest = url.includes('/auth/login')
    const isRefreshRequest = url.includes('/auth/refresh')

    if (err.response?.status !== 401 || isLoginRequest) {
      return Promise.reject(err)
    }

    if (isRefreshRequest || !config || config._retry) {
      logoutAndRedirect()
      return Promise.reject(err)
    }

    try {
      config._retry = true
      const { token: newToken } = await silentRefresh()
      config.headers = { ...config.headers, Authorization: `Bearer ${newToken}` }
      return client(config)
    } catch {
      logoutAndRedirect()
      return Promise.reject(err)
    }
  },
)

export default client

let socket: Socket | null = null

/**
 * Opens (or reuses) the shared realtime connection for anomaly/recall alerts,
 * authenticated with the current access token — the backend rejects the
 * Socket.IO handshake without one, so anonymous clients can no longer receive
 * the anomaly/recall firehose. Connects to the current page's own origin and
 * lets the dev-server proxy (vite.config.ts) or the production reverse proxy
 * (nginx.conf) forward `/socket.io` to the backend, same as `/api`.
 */
export function connectSocket(token: string): Socket {
  if (socket) {
    if ((socket.auth as { token?: string })?.token === token && socket.connected) return socket
    socket.disconnect()
  }
  socket = io({ path: '/socket.io', transports: ['websocket', 'polling'], auth: { token } })
  return socket
}

export function disconnectSocket(): void {
  socket?.disconnect()
  socket = null
}

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

export const STAGE_ICONS: Record<SupplyChainStage, LucideIcon> = {
  HARVEST: Sprout,
  PROCESSING: Factory,
  QUALITY_CHECK: Microscope,
  PACKAGING: Package,
  DISTRIBUTION: Truck,
  RETAIL: Store,
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
  // Omitted by the backend for non-ADMIN viewers looking at someone else's
  // profile (see AdminService.redact) — always present for your own /auth/me.
  email?: string
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
  /** Who's currently authorized to record the batch's next event — undefined means unclaimed. */
  assignedToActorId?: string
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

export type AnomalyType = 'STAGE_SKIPPED' | 'DUPLICATE_STAGE' | 'OUT_OF_ORDER' | 'CHAIN_TAMPERED'

export type AnomalySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface Anomaly {
  id: string
  type: AnomalyType
  severity: AnomalySeverity
  message: string
  batchId: string
  eventId?: string
  detectedAt: string
  resolved: boolean
  resolvedBy?: string
  resolvedAt?: string
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

export interface StatsOverview {
  totalBatches: number
  activeBatches: number
  recalledBatches: number
  totalEvents: number
  anomalyCount: number
}

export interface StatsByStage {
  stage: SupplyChainStage
  count: number
}

export interface StatsByDay {
  date: string
  count: number
}

export interface StatsByOrigin {
  origin: string
  batchCount: number
  anomalyCount: number
}

export interface PartnerSummary {
  organization: string
  actorCount: number
  roles: ActorRole[]
}

export interface ActorDetail {
  actor: Actor
  batches: Batch[]
}

export interface SessionInfo {
  token: string
  expiresAt: string
  createdAt: string
}

export interface NotificationItem {
  id: string
  kind: 'ANOMALY' | 'RECALL'
  message: string
  severity?: AnomalySeverity
  batchId: string
  createdAt: string
}

export interface ChainVerification {
  valid: boolean
  brokenAtIndex?: number
  perEvent: Array<{ eventId: string; recomputedHash: string; matchesStoredHash: boolean; linksToPrevious: boolean }>
}

export interface FullVerifyResult extends ChainVerification {
  batch: Pick<Batch, 'id' | 'productName'>
  events: TraceEvent[]
}

export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface AuditLogEntry {
  id: string
  actorId: string | null
  action: string
  entityType: string
  entityId: string | null
  metadata: Record<string, unknown>
  createdAt: string
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
    tenantSlug: string
    tenantName?: string
  }) => client.post<Actor>('/auth/register', body).then((r) => r.data),

  // Relies on the httpOnly refreshToken cookie the backend set at login —
  // used both for the on-401 silent refresh and for restoring a session on
  // app load (see AuthContext). Shares silentRefresh's in-flight dedup so a
  // mount-time restore racing a 401 retry can't rotate the same token twice.
  refresh: silentRefresh,

  logout: () => client.post('/auth/logout').then(() => undefined),

  me: () => client.get<Actor>('/auth/me').then((r) => r.data),

  updateProfile: (body: { name?: string; organization?: string }) =>
    client.patch<Actor>('/auth/me', body).then((r) => r.data),

  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    client.patch('/auth/me/password', body).then(() => undefined),

  sessions: () => client.get<SessionInfo[]>('/auth/sessions').then((r) => r.data),

  revokeSession: (tokenPrefix: string) => client.delete(`/auth/sessions/${tokenPrefix}`).then(() => undefined),
}

export const batchApi = {
  list: (params?: { page?: number; pageSize?: number; search?: string }) =>
    client.get<PaginatedResult<Batch>>('/batches', { params }).then((r) => r.data),
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
  qrSvg: (id: string) =>
    client.get<string>(`/batches/${id}/qr`, { responseType: 'text' as const }).then((r) => r.data),
  pending: () => client.get<Batch[]>('/batches/pending').then((r) => r.data),
  exportCsv: (params: { from?: string; to?: string; origin?: string }) =>
    client
      .get<string>('/batches/export', { params: { ...params, format: 'csv' }, responseType: 'text' as const })
      .then((r) => r.data),
}

export const eventApi = {
  record: (body: {
    batchId: string
    stage: SupplyChainStage
    location: string
    notes?: string
    data?: Record<string, unknown>
    /** Who takes custody next — required unless `stage` is the terminal RETAIL stage (backend-enforced for non-ADMIN callers). */
    assignNextTo?: string
  }) => client.post<TraceEvent>('/events', body).then((r) => r.data),
}

export const traceApi = {
  forward: (batchId: string) =>
    client.get<TraceResult>(`/trace/${batchId}`).then((r) => r.data),
  backward: (batchId: string) =>
    client.get<TraceResult>(`/trace/${batchId}?direction=backward`).then((r) => r.data),
  public: (batchId: string) =>
    client.get<PublicTrace>(`/trace/public/${batchId}`).then((r) => r.data),
  verifyFull: (batchId: string) =>
    client.get<FullVerifyResult>(`/trace/public/${batchId}/full`).then((r) => r.data),
}

export const statsApi = {
  overview: () => client.get<StatsOverview>('/stats/overview').then((r) => r.data),
  byStage: () => client.get<StatsByStage[]>('/stats/by-stage').then((r) => r.data),
  byDay: () => client.get<StatsByDay[]>('/stats/by-day').then((r) => r.data),
  byOrigin: () => client.get<StatsByOrigin[]>('/stats/by-origin').then((r) => r.data),
}

export const adminApi = {
  auditLogs: (page = 1, pageSize = 20) =>
    client.get<PaginatedResult<AuditLogEntry>>('/admin/audit-logs', { params: { page, pageSize } }).then((r) => r.data),
  anomalies: (params: { page?: number; pageSize?: number; resolved?: boolean; severity?: AnomalySeverity }) =>
    client.get<PaginatedResult<Anomaly>>('/admin/anomalies', { params }).then((r) => r.data),
  resolveAnomaly: (id: string) =>
    client.patch<Anomaly>(`/admin/anomalies/${id}/resolve`).then((r) => r.data),
}

export const actorsApi = {
  list: () => client.get<Actor[]>('/actors').then((r) => r.data),
  partners: () => client.get<PartnerSummary[]>('/actors/partners').then((r) => r.data),
  detail: (id: string) => client.get<ActorDetail>(`/actors/${id}`).then((r) => r.data),
  setStatus: (id: string, isActive: boolean) =>
    client.patch<Actor>(`/actors/${id}/status`, { isActive }).then((r) => r.data),
  setRole: (id: string, role: ActorRole) =>
    client.patch<Actor>(`/actors/${id}/role`, { role }).then((r) => r.data),
}

export const notificationsApi = {
  list: (limit = 20) => client.get<NotificationItem[]>('/notifications', { params: { limit } }).then((r) => r.data),
}
