import { ActorRole, Batch, ROLE_STAGES, STAGE_ORDER, SupplyChainStage } from '../api/client'

/**
 * What each stage actually records, beyond "where" and free-text notes.
 * Stored in the event's `data` (flat key → scalar), so it becomes part of the
 * hash-chained record. Select values are stored as stable codes and shown
 * through their labels, so reports group cleanly no matter who typed what.
 *
 * `public: true` marks the facts shown on the consumer provenance page — the
 * backend enforces the same list (PUBLIC_EVENT_FIELDS in domain/types.ts);
 * this flag only drives the UI hint.
 */
export interface StageFieldOption {
  value: string
  label: string
}

export interface StageField {
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'select'
  required?: boolean
  unit?: string
  placeholder?: string
  options?: StageFieldOption[]
  min?: number
  max?: number
  public?: boolean
}

export const STAGE_FIELDS: Record<SupplyChainStage, StageField[]> = {
  HARVEST: [
    { key: 'harvestDate', label: 'Ngày thu hoạch', type: 'date', required: true, public: true },
    { key: 'variety', label: 'Giống', type: 'text', placeholder: 'VD: Arabica Catimor, ST25', public: true },
    {
      key: 'cultivation',
      label: 'Tiêu chuẩn canh tác',
      type: 'select',
      public: true,
      options: [
        { value: 'CONVENTIONAL', label: 'Thông thường' },
        { value: 'VIETGAP', label: 'VietGAP' },
        { value: 'GLOBALGAP', label: 'GlobalG.A.P.' },
        { value: 'ORGANIC', label: 'Hữu cơ' },
      ],
    },
  ],
  PROCESSING: [
    {
      key: 'method',
      label: 'Phương pháp chế biến',
      type: 'select',
      required: true,
      public: true,
      options: [
        { value: 'WET', label: 'Chế biến ướt' },
        { value: 'DRY', label: 'Chế biến khô (phơi nguyên trái)' },
        { value: 'HONEY', label: 'Honey' },
        { value: 'DRYING', label: 'Sấy' },
        { value: 'MILLING', label: 'Xay xát / tách vỏ' },
        { value: 'ROASTING', label: 'Rang' },
        { value: 'CLEANING', label: 'Sơ chế, làm sạch' },
        { value: 'OTHER', label: 'Khác' },
      ],
    },
    { key: 'outputQuantity', label: 'Sản lượng sau chế biến', type: 'number', min: 0, unit: 'theo đơn vị lô' },
    { key: 'moisture', label: 'Độ ẩm', type: 'number', min: 0, max: 100, unit: '%' },
  ],
  QUALITY_CHECK: [
    {
      key: 'result',
      label: 'Kết quả',
      type: 'select',
      required: true,
      public: true,
      options: [
        { value: 'PASS', label: 'Đạt' },
        { value: 'FAIL', label: 'Không đạt' },
      ],
    },
    { key: 'grade', label: 'Phân hạng', type: 'text', placeholder: 'VD: Loại 1 (S18)', public: true },
    { key: 'moisture', label: 'Độ ẩm', type: 'number', min: 0, max: 100, unit: '%' },
    { key: 'certificateNo', label: 'Số phiếu / chứng nhận', type: 'text', public: true },
  ],
  PACKAGING: [
    {
      key: 'packageType',
      label: 'Quy cách đóng gói',
      type: 'select',
      required: true,
      public: true,
      options: [
        { value: 'BAG_60KG', label: 'Bao 60 kg' },
        { value: 'BAG_30KG', label: 'Bao 30 kg' },
        { value: 'BAG_1KG', label: 'Túi 1 kg' },
        { value: 'BAG_500G', label: 'Túi 500 g' },
        { value: 'CARTON', label: 'Thùng carton' },
        { value: 'OTHER', label: 'Khác' },
      ],
    },
    { key: 'packageCount', label: 'Số lượng kiện', type: 'number', required: true, min: 1 },
    { key: 'expiryDate', label: 'Hạn sử dụng', type: 'date', public: true },
  ],
  DISTRIBUTION: [
    { key: 'destination', label: 'Nơi nhận', type: 'text', required: true, placeholder: 'VD: Kho Bình Dương', public: true },
    { key: 'vehicle', label: 'Phương tiện / biển số', type: 'text', placeholder: 'VD: 51C-123.45' },
    { key: 'temperature', label: 'Nhiệt độ bảo quản', type: 'number', unit: '°C' },
  ],
  RETAIL: [
    { key: 'storeName', label: 'Cửa hàng', type: 'text', required: true, public: true },
    { key: 'shelfDate', label: 'Ngày lên kệ', type: 'date', public: true },
  ],
}

/**
 * Product types. The coffee and rubber forms are the ones the platform has
 * conversion factors and yield caps for (backend migration 014), so mass
 * balance is checked for them; the generic ones are kept for other crops.
 */
export const PRODUCT_TYPES = [
  'Cà phê quả tươi',
  'Cà phê nhân xô',
  'Cà phê nhân xanh',
  'Cà phê rang',
  'Mủ cao su nước',
  'Cao su khối',
  'Cà phê',
  'Lúa gạo',
  'Trái cây',
  'Rau củ',
  'Chè',
  'Gia vị',
  'Thủy sản',
  'Khác',
] as const

/** Mirrors backend conversion_factors (SPEC §5) — for the form's live hint only; the server decides. */
export const CONVERSION_HINTS: Record<string, Record<string, [number, number]>> = {
  'Cà phê quả tươi': { 'Cà phê nhân xanh': [0.16, 0.22], 'Cà phê nhân xô': [0.4, 0.5] },
  'Cà phê nhân xô': { 'Cà phê nhân xanh': [0.78, 0.85] },
  'Cà phê nhân xanh': { 'Cà phê rang': [0.8, 0.88] },
  'Mủ cao su nước': { 'Cao su khối': [0.28, 0.4] },
}

/** kg for weight units, null for count units (bao, thùng) — SPEC §5. */
export function toKg(quantity: number, unit: string): number | null {
  const u = unit.trim().toLowerCase()
  if (u === 'kg') return quantity
  if (u === 'tấn') return quantity * 1000
  return null
}

export const UNITS: StageFieldOption[] = [
  { value: 'kg', label: 'kg' },
  { value: 'tấn', label: 'tấn' },
  { value: 'bao', label: 'bao' },
  { value: 'thùng', label: 'thùng' },
]

/** Human-readable value for a stored stage fact — option codes become their labels. */
export function formatFieldValue(stage: SupplyChainStage, key: string, value: unknown): string {
  const field = STAGE_FIELDS[stage].find((f) => f.key === key)
  if (value === null || value === undefined || value === '') return ''
  if (field?.type === 'select') {
    return field.options?.find((o) => o.value === value)?.label ?? String(value)
  }
  if (field?.type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-')
    return `${d}/${m}/${y}`
  }
  if (typeof value === 'boolean') return value ? 'Có' : 'Không'
  const text = String(value)
  return field?.unit && field.type === 'number' && !field.unit.startsWith('theo') ? `${text} ${field.unit}` : text
}

/** The stage facts of an event as label/value rows, in the stage's field order (unknown keys last). */
export function describeEventData(
  stage: SupplyChainStage,
  data: Record<string, unknown>,
  opts: { publicOnly?: boolean } = {},
): Array<{ key: string; label: string; value: string }> {
  const fields = STAGE_FIELDS[stage]
  const known = fields
    .filter((f) => !opts.publicOnly || f.public)
    .filter((f) => data[f.key] !== undefined && data[f.key] !== '')
    .map((f) => ({ key: f.key, label: f.label, value: formatFieldValue(stage, f.key, data[f.key]) }))
  if (opts.publicOnly) return known
  const extra = Object.keys(data)
    .filter((k) => !fields.some((f) => f.key === k))
    .map((k) => ({ key: k, label: k, value: String(data[k]) }))
  return [...known, ...extra]
}

/** The stage that comes next for this batch, or null once it has reached the end of the chain. */
export function nextStageOf(batch: Pick<Batch, 'currentStage'>): SupplyChainStage | null {
  const idx = batch.currentStage ? STAGE_ORDER.indexOf(batch.currentStage) : -1
  return STAGE_ORDER[idx + 1] ?? null
}

/** Roles that can take custody for `stage`. */
export function rolesForStage(stage: SupplyChainStage): ActorRole[] {
  return (Object.keys(ROLE_STAGES) as ActorRole[]).filter((r) => r !== 'ADMIN' && ROLE_STAGES[r].includes(stage))
}

/**
 * Whether `actor` is the one expected to act on the batch right now: its next
 * stage is theirs, it isn't recalled, and custody is theirs (or unclaimed).
 * ADMIN can always step in.
 */
export function canActOn(
  actor: { id: string; role: ActorRole },
  batch: Pick<Batch, 'currentStage' | 'isRecalled' | 'assignedToActorId'>,
): boolean {
  const next = nextStageOf(batch)
  if (!next || batch.isRecalled) return false
  if (actor.role === 'ADMIN') return true
  if (!ROLE_STAGES[actor.role].includes(next)) return false
  return !batch.assignedToActorId || batch.assignedToActorId === actor.id
}

export function daysSince(iso: string | undefined): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000))
}

/** "hôm nay", "hôm qua", "3 ngày trước" — for "how long has this been waiting". */
export function relativeDays(iso: string | undefined): string {
  const d = daysSince(iso)
  if (d === null) return ''
  if (d <= 0) return 'hôm nay'
  if (d === 1) return 'hôm qua'
  return `${d} ngày trước`
}
