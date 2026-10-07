import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, TriangleAlert } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  actorsApi,
  Actor,
  batchApi,
  Batch,
  eventApi,
  ROLE_LABELS,
  STAGE_ICONS,
  STAGE_LABELS,
  STAGE_ORDER,
  SupplyChainStage,
} from '../api/client'
import { canActOn, nextStageOf, rolesForStage } from '../domain/stageFields'
import { apiErrorMessage } from '../lib/apiError'
import { rememberLocation, recallLocation } from '../lib/lastLocation'
import StageFieldsInput, { StageValues, toEventData } from '../components/StageFieldsInput'
import HandoffSelect from '../components/HandoffSelect'
import Button, { buttonClass } from '../components/ui/Button'
import { inputClass, labelClass } from '../components/ui/field'
import { cardClass } from '../components/ui/Card'
import { Skeleton } from '../components/ui/Skeleton'

/**
 * "Xử lý lô hàng": the one screen every partner uses to complete their stage.
 * The stage isn't chosen — it's whatever comes next for this batch — and the
 * form asks for that stage's own facts (moisture for processing, result for
 * a quality check, destination for distribution...), not a generic note box.
 * Reached from "Việc cần làm" or a batch's detail page; batches are created
 * on /batches/new.
 */
export default function RecordEvent() {
  const { actor } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const batchId = searchParams.get('batchId') ?? ''

  const [batch, setBatch] = useState<Batch | null>(null)
  const [actors, setActors] = useState<Actor[]>([])
  const [loadError, setLoadError] = useState('')
  const [stage, setStage] = useState<SupplyChainStage | null>(null)
  const [values, setValues] = useState<StageValues>({})
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [assignNextTo, setAssignNextTo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const isAdmin = actor?.role === 'ADMIN'

  useEffect(() => {
    if (!batchId) return
    batchApi
      .get(batchId)
      .then((b) => {
        setBatch(b)
        setStage(nextStageOf(b))
      })
      .catch((err) => setLoadError(apiErrorMessage(err, 'Không tải được lô hàng.')))
    actorsApi.list().then(setActors).catch(() => {})
  }, [batchId])

  // Sensible location default: the farm itself for harvest, otherwise where
  // this person last recorded the same stage (a processor's factory rarely moves).
  useEffect(() => {
    if (!batch || !stage || !actor) return
    setLocation(stage === 'HARVEST' ? batch.origin : recallLocation(actor.id, stage) ?? '')
    setValues({})
    setAssignNextTo('')
  }, [batch, stage, actor])

  const stageAfter = useMemo<SupplyChainStage | null>(() => {
    if (!stage) return null
    return STAGE_ORDER[STAGE_ORDER.indexOf(stage) + 1] ?? null
  }, [stage])

  // An ADMIN back-filling an earlier stage doesn't move custody, so no hand-off is asked for.
  const isAdvancing = !!batch && !!stage && STAGE_ORDER.indexOf(stage) > (batch.currentStage ? STAGE_ORDER.indexOf(batch.currentStage) : -1)
  const needsHandoff = isAdvancing && stageAfter !== null

  const onHandoffChange = useCallback((id: string) => setAssignNextTo(id), [])

  if (!batchId) {
    // No batch picked: creators start a new one, everyone else goes to their queue.
    return <Navigate to={actor?.role === 'FARMER' || isAdmin ? '/batches/new' : '/tasks'} replace />
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!batch || !stage || !actor) return
    setError('')
    setSubmitting(true)
    try {
      await eventApi.record({
        batchId: batch.id,
        stage,
        location: location.trim(),
        notes: notes.trim() || undefined,
        data: toEventData(stage, values),
        assignNextTo: needsHandoff ? assignNextTo || undefined : undefined,
      })
      rememberLocation(actor.id, stage, location.trim())
      const failedQc = stage === 'QUALITY_CHECK' && values.result === 'FAIL'
      navigate(`/batch/${batch.id}${failedQc ? '?recall=suggest' : ''}`, {
        state: { flash: `Đã ghi nhận khâu ${STAGE_LABELS[stage].toLowerCase()}.` },
      })
    } catch (err) {
      setError(apiErrorMessage(err, 'Ghi sự kiện thất bại. Thử lại sau.'))
    } finally {
      setSubmitting(false)
    }
  }

  const header = (
    <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label="Quay lại"
        className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>
      <h1 className="font-semibold text-slate-900 dark:text-slate-50">Xử lý lô hàng</h1>
    </header>
  )

  if (loadError) {
    return (
      <div className="page-shell">
        {header}
        <main className="max-w-lg mx-auto p-4">
          <div className={cardClass({ className: 'text-center' })}>
            <p className="text-sm text-rose-600 dark:text-rose-400">{loadError}</p>
            <Link to="/tasks" className={buttonClass('secondary', 'sm', 'mt-4')}>
              Về việc cần làm
            </Link>
          </div>
        </main>
      </div>
    )
  }

  if (!batch || !actor) {
    return (
      <div className="page-shell">
        {header}
        <main className="max-w-lg mx-auto p-4 space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-72 w-full" />
        </main>
      </div>
    )
  }

  const next = nextStageOf(batch)
  const blocked = !canActOn(actor, batch)
  const StageIcon = stage ? STAGE_ICONS[stage] : null

  return (
    <div className="page-shell">
      {header}
      <main className="max-w-lg mx-auto p-4 space-y-4">
        {/* What am I working on */}
        <Link to={`/batch/${batch.id}`} className={cardClass({ hover: true, padding: 'md' })}>
          <p className="font-semibold text-slate-900 dark:text-slate-50">{batch.productName}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {batch.productType} · {batch.origin} · {batch.quantity} {batch.unit}
          </p>
          <div className="flex items-center gap-2 mt-3 text-xs">
            <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {batch.currentStage ? STAGE_LABELS[batch.currentStage] : 'Chưa bắt đầu'}
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
            <span className="px-2 py-1 rounded-full bg-brand-50 text-brand-700 font-medium dark:bg-brand-500/10 dark:text-brand-400">
              {next ? STAGE_LABELS[next] : 'Đã hoàn tất'}
            </span>
          </div>
        </Link>

        {blocked ? (
          <div className={cardClass({ className: 'flex gap-3' })}>
            <TriangleAlert className="w-5 h-5 text-amber-500 flex-shrink-0" />
            <div className="text-sm text-slate-600 dark:text-slate-300">
              {batch.isRecalled ? (
                <p>Lô hàng đã bị thu hồi — không thể ghi thêm sự kiện.</p>
              ) : !next ? (
                <p>Lô hàng đã đi hết chuỗi cung ứng.</p>
              ) : (
                <p>
                  Lô này đang chờ khâu <strong>{STAGE_LABELS[next].toLowerCase()}</strong>
                  {batch.assignedToActorId && batch.assignedToActorId !== actor.id
                    ? ' và đã được bàn giao cho người khác.'
                    : ` — việc của ${rolesForStage(next).map((r) => ROLE_LABELS[r].toLowerCase()).join(' hoặc ')}.`}
                </p>
              )}
              <Link to="/tasks" className="text-brand-600 dark:text-brand-400 font-medium hover:underline mt-2 inline-block">
                Xem việc của bạn →
              </Link>
            </div>
          </div>
        ) : (
          stage && (
            <form onSubmit={handleSubmit} className={cardClass({ padding: 'lg', className: 'space-y-5' })}>
              <div className="flex items-center gap-3">
                {StageIcon && (
                  <span className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400 flex items-center justify-center">
                    <StageIcon className="w-5 h-5" />
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Ghi nhận khâu</p>
                  {isAdmin ? (
                    <select
                      aria-label="Khâu ghi nhận"
                      value={stage}
                      onChange={(e) => setStage(e.target.value as SupplyChainStage)}
                      className="font-semibold text-slate-900 dark:text-slate-50 bg-transparent -ml-1 pr-6 rounded focus:outline-none focus:ring-2 focus:ring-brand-400"
                    >
                      {STAGE_ORDER.map((s) => (
                        <option key={s} value={s}>
                          {STAGE_LABELS[s]}
                          {s === next ? ' (tiếp theo)' : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="font-semibold text-slate-900 dark:text-slate-50">{STAGE_LABELS[stage]}</p>
                  )}
                </div>
              </div>
              {isAdmin && stage !== next && (
                <p className="text-xs text-amber-600 dark:text-amber-400 -mt-2">
                  Ghi khác thứ tự sẽ tạo cảnh báo bất thường — chỉ dùng để bổ sung dữ liệu.
                </p>
              )}

              <StageFieldsInput stage={stage} values={values} onChange={setValues} unitHint={batch.unit} />

              {stage === 'QUALITY_CHECK' && values.result === 'FAIL' && (
                <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl p-3 text-sm text-rose-700 dark:text-rose-300">
                  Lô không đạt. Sau khi ghi nhận, bạn sẽ được đề nghị thu hồi lô hàng.
                </div>
              )}

              <div>
                <label htmlFor="location" className={labelClass}>
                  Địa điểm thực hiện <span className="text-rose-500">*</span>
                </label>
                <input
                  id="location"
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  required
                  maxLength={200}
                  placeholder="VD: Xưởng chế biến An Giang"
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="notes" className={labelClass}>
                  Ghi chú
                </label>
                <textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="Chỉ nội bộ — không hiển thị cho người tiêu dùng"
                  className={`${inputClass} resize-none`}
                />
              </div>

              {needsHandoff && stageAfter && (
                <HandoffSelect
                  nextStage={stageAfter}
                  actors={actors.filter((a) => a.id !== actor.id || isAdmin)}
                  value={assignNextTo}
                  onChange={onHandoffChange}
                  isAdmin={isAdmin}
                />
              )}

              {error && (
                <div role="alert" className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-sm rounded-xl px-3.5 py-2.5">
                  {error}
                </div>
              )}

              <Button type="submit" disabled={submitting} className="w-full">
                {submitting
                  ? 'Đang ghi...'
                  : needsHandoff
                    ? `Hoàn tất ${STAGE_LABELS[stage].toLowerCase()} & bàn giao`
                    : `Hoàn tất ${STAGE_LABELS[stage].toLowerCase()}`}
              </Button>
            </form>
          )
        )}
      </main>
    </div>
  )
}
