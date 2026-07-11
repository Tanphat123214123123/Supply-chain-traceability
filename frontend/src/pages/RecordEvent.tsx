import { useEffect, useMemo, useState, FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Info, ArrowLeft } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  batchApi, eventApi, actorsApi,
  Actor, ActorRole, Batch, SupplyChainStage,
  STAGE_LABELS, STAGE_ORDER, ROLE_STAGES, ROLE_LABELS,
} from '../api/client'
import Button from '../components/ui/Button'
import { inputClass, labelClass } from '../components/ui/field'
import { cardClass } from '../components/ui/Card'

type ApiErr = { response?: { data?: { error?: string } } }

/** Which roles are allowed to record the stage right after `stage` — empty if `stage` is terminal (RETAIL). */
function nextStageRoles(stage: SupplyChainStage): ActorRole[] {
  const idx = STAGE_ORDER.indexOf(stage)
  if (idx === STAGE_ORDER.length - 1) return []
  const nextStage = STAGE_ORDER[idx + 1]
  return (Object.keys(ROLE_STAGES) as ActorRole[]).filter((r) => ROLE_STAGES[r].includes(nextStage))
}

export default function RecordEvent() {
  const { actor } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [batches, setBatches] = useState<Batch[]>([])
  const [actors, setActors] = useState<Actor[]>([])
  const [mode, setMode] = useState<'existing' | 'new'>(searchParams.get('batchId') ? 'existing' : 'new')
  const [batchId, setBatchId] = useState(searchParams.get('batchId') ?? '')
  const [stage, setStage] = useState<SupplyChainStage | ''>('')
  const [assignNextTo, setAssignNextTo] = useState('')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // New-batch fields (only used when mode === 'new')
  const [productName, setProductName] = useState('')
  const [productType, setProductType] = useState('')
  const [origin, setOrigin] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('kg')

  const allowedStages = actor ? ROLE_STAGES[actor.role] : []
  // A batch represents a physical good's origin — only whoever actually
  // harvested it (or an ADMIN) can bring one into existence; everyone else in
  // the chain only ever adds an event to a batch someone upstream created.
  // Mirrors the backend's requireRole('FARMER', 'ADMIN') on POST /api/batches.
  const canCreateBatch = actor?.role === 'FARMER' || actor?.role === 'ADMIN'

  const isTerminalStage = stage ? STAGE_ORDER.indexOf(stage) === STAGE_ORDER.length - 1 : false
  const candidateNextActors = useMemo(() => {
    if (!stage || isTerminalStage) return []
    const roles = nextStageRoles(stage)
    return actors.filter((a) => a.isActive && roles.includes(a.role))
  }, [actors, stage, isTerminalStage])

  useEffect(() => {
    // Only batches actually assigned to me (or unclaimed, or any if I'm ADMIN)
    // whose next stage I'm allowed to record — a "what can I actually do
    // right now" list, not every batch in the system.
    batchApi.pending().then(setBatches).catch(() => {})
    actorsApi.list().then(setActors).catch(() => {})
  }, [])

  useEffect(() => {
    if (!canCreateBatch && mode === 'new') setMode('existing')
  }, [canCreateBatch, mode])

  useEffect(() => {
    setAssignNextTo('')
  }, [stage])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!stage) return
    setError('')
    setLoading(true)
    try {
      let targetBatchId = batchId

      if (mode === 'new') {
        // Batch creation and event recording are two separate calls — if the
        // second one fails, fall through to 'existing' mode with the batch
        // that was already created, so it isn't stranded with zero events.
        const newBatch = await batchApi.create({
          productName,
          productType,
          origin,
          quantity: Number(quantity),
          unit,
        })
        targetBatchId = newBatch.id
        setBatches((prev) => [newBatch, ...prev])
        setBatchId(newBatch.id)
        setMode('existing')
      }

      const event = await eventApi.record({
        batchId: targetBatchId,
        stage,
        location,
        notes: notes.trim() || undefined,
        assignNextTo: isTerminalStage ? undefined : assignNextTo || undefined,
      })
      navigate(`/batch/${event.batchId}`)
    } catch (err) {
      setError(
        (err as ApiErr)?.response?.data?.error ??
          (mode === 'new'
            ? 'Đã tạo lô hàng nhưng ghi sự kiện thất bại — thử ghi lại cho lô hàng vừa tạo.'
            : 'Ghi sự kiện thất bại'),
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-shell">
      <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button
          onClick={() => navigate(-1)}
          className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="font-semibold text-slate-900 dark:text-slate-50">Ghi sự kiện chuỗi cung ứng</h1>
      </header>

      <main className="max-w-lg mx-auto p-4">
        {/* Actor info */}
        {actor && (
          <div className="bg-brand-50 dark:bg-brand-500/10 border border-brand-100 dark:border-brand-500/20 rounded-xl p-3.5 mb-4 text-sm text-brand-700 dark:text-brand-400 flex gap-2">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <p>
              Bạn đang đăng nhập với vai trò <strong>{actor.name}</strong>.
              Các khâu được phép: {allowedStages.map((s) => STAGE_LABELS[s]).join(', ')}.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className={cardClass({ padding: 'lg', className: 'space-y-5' })}>
          {/* Batch mode toggle */}
          <div>
            <label className={labelClass}>
              Lô hàng <span className="text-rose-500">*</span>
            </label>
            {canCreateBatch && (
              <div className="flex rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 mb-3">
                <button
                  type="button"
                  onClick={() => setMode('existing')}
                  className={`flex-1 text-sm px-3 py-2 transition-colors ${
                    mode === 'existing' ? 'bg-brand-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  Lô hàng có sẵn
                </button>
                <button
                  type="button"
                  onClick={() => setMode('new')}
                  className={`flex-1 text-sm px-3 py-2 transition-colors ${
                    mode === 'new' ? 'bg-brand-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  Tạo lô hàng mới
                </button>
              </div>
            )}

            {mode === 'existing' ? (
              <>
                <select
                  value={batchId}
                  onChange={(e) => setBatchId(e.target.value)}
                  required
                  aria-label="Chọn lô hàng"
                  className={inputClass}
                >
                  <option value="">— Chọn lô hàng —</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.productName} · {b.origin} ({b.id.slice(0, 8)}…)
                    </option>
                  ))}
                </select>
                {batches.length === 0 && (
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">
                    Không có lô hàng nào đang chờ bạn xử lý — lô hàng chỉ hiện ở đây khi đã được bàn giao cho bạn.
                  </p>
                )}
              </>
            ) : (
              <div className="space-y-3 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl p-3">
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    required
                    placeholder="Tên sản phẩm"
                    className={`col-span-2 ${inputClass}`}
                  />
                  <input
                    type="text"
                    value={productType}
                    onChange={(e) => setProductType(e.target.value)}
                    required
                    placeholder="Loại (VD: Nông sản)"
                    className={inputClass}
                  />
                  <input
                    type="text"
                    value={origin}
                    onChange={(e) => setOrigin(e.target.value)}
                    required
                    placeholder="Xuất xứ"
                    className={inputClass}
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    required
                    placeholder="Số lượng"
                    className={inputClass}
                  />
                  <input
                    type="text"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    required
                    placeholder="Đơn vị (VD: kg)"
                    className={inputClass}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Stage */}
          <div>
            <label className={labelClass}>
              Khâu sản xuất <span className="text-rose-500">*</span>
            </label>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value as SupplyChainStage)}
              required
              aria-label="Chọn khâu sản xuất"
              className={inputClass}
            >
              <option value="">— Chọn khâu —</option>
              {allowedStages.map((s) => (
                <option key={s} value={s}>{STAGE_LABELS[s]}</option>
              ))}
            </select>
          </div>

          {/* Hand-off: who takes custody next */}
          {stage && !isTerminalStage && (
            <div>
              <label className={labelClass}>
                Bàn giao cho <span className="text-rose-500">*</span>
              </label>
              <select
                value={assignNextTo}
                onChange={(e) => setAssignNextTo(e.target.value)}
                required
                aria-label="Chọn người tiếp nhận"
                className={inputClass}
              >
                <option value="">— Chọn người tiếp nhận —</option>
                {candidateNextActors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.organization} ({ROLE_LABELS[a.role]})
                  </option>
                ))}
              </select>
              {candidateNextActors.length === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
                  Chưa có tài khoản nào ở khâu tiếp theo để bàn giao — cần một tài khoản{' '}
                  {nextStageRoles(stage).map((r) => ROLE_LABELS[r]).join(' hoặc ')} đăng ký trước.
                </p>
              )}
            </div>
          )}

          {/* Location */}
          <div>
            <label className={labelClass}>
              Địa điểm <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              required
              placeholder="VD: Đà Lạt, Lâm Đồng"
              className={inputClass}
            />
          </div>

          {/* Notes */}
          <div>
            <label className={labelClass}>Ghi chú (tuỳ chọn)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Thông tin bổ sung về lô hàng, kiểm tra chất lượng..."
              className={`${inputClass} resize-none`}
            />
          </div>

          {error && (
            <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-sm rounded-xl px-3.5 py-2.5 animate-scale-in">
              {error}
            </div>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Đang ghi...' : 'Xác nhận ghi sự kiện'}
          </Button>
        </form>
      </main>
    </div>
  )
}
