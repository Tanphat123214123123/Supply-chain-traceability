import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ChevronDown, Clock3, Download, ExternalLink, Siren, TriangleAlert } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  Actor,
  actorsApi,
  batchApi,
  traceApi,
  TraceResult,
  ROLE_LABELS,
  STAGE_ICONS,
  STAGE_LABELS,
  STAGE_ORDER,
} from '../api/client'
import { canActOn, nextStageOf, relativeDays } from '../domain/stageFields'
import { apiErrorMessage } from '../lib/apiError'
import { buildBatchReport } from '../lib/reports/model'
import { downloadBlob, MIME } from '../lib/reports/download'
import Timeline from '../components/Timeline'
import VerifyBadge from '../components/VerifyBadge'
import RecallDialog from '../components/RecallDialog'
import VerifyPanel from '../components/VerifyPanel'
import LineagePanel from '../components/LineagePanel'
import HandOffPanel from '../components/HandOffPanel'
import Badge from '../components/ui/Badge'
import { buttonClass } from '../components/ui/Button'
import { cardClass } from '../components/ui/Card'
import { Skeleton, SkeletonCardList } from '../components/ui/Skeleton'

/** Six-step progress: done / current / upcoming, so "where is this batch" reads at a glance. */
function StageProgress({ current, recalled }: { current: TraceResult['batch']['currentStage']; recalled: boolean }) {
  const currentIdx = current ? STAGE_ORDER.indexOf(current) : -1
  return (
    <ol className="flex items-start" aria-label="Tiến độ chuỗi cung ứng">
      {STAGE_ORDER.map((stage, i) => {
        const Icon = STAGE_ICONS[stage]
        const done = i <= currentIdx
        const isNext = i === currentIdx + 1 && !recalled
        return (
          <li key={stage} className="flex-1 flex flex-col items-center text-center min-w-0 relative">
            {i > 0 && (
              <span
                aria-hidden="true"
                className={`absolute top-4 right-1/2 w-full h-0.5 -z-0 ${done ? 'bg-emerald-400 dark:bg-emerald-500/60' : 'bg-slate-200 dark:bg-slate-700'}`}
              />
            )}
            <span
              className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center border-2 ${
                done
                  ? 'bg-emerald-500 border-emerald-500 text-white'
                  : isNext
                    ? 'bg-white dark:bg-slate-900 border-brand-500 text-brand-600 dark:text-brand-400 ring-4 ring-brand-100 dark:ring-brand-500/20'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-300 dark:text-slate-600'
              }`}
            >
              {done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
            </span>
            <span
              className={`mt-1.5 text-[11px] leading-tight px-0.5 ${
                done ? 'text-slate-700 dark:text-slate-200' : isNext ? 'text-brand-700 dark:text-brand-400 font-semibold' : 'text-slate-400 dark:text-slate-500'
              }`}
            >
              {STAGE_LABELS[stage]}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

type ExportFormat = 'docx' | 'xlsx'

const EXPORT_OPTIONS: Array<{ format: ExportFormat; label: string; hint: string }> = [
  { format: 'docx', label: 'Word (.docx)', hint: 'In ấn, chỉnh sửa, đính kèm hồ sơ' },
  { format: 'xlsx', label: 'Excel (.xlsx)', hint: 'Lọc, tính toán số liệu' },
]

const FORMAT_NAMES: Record<ExportFormat, string> = { docx: 'Word', xlsx: 'Excel' }

/**
 * Every format is generated in the browser from the same report model
 * (lib/reports/model.ts) and only its library is downloaded on first use.
 */
function ExportMenu({ result, actorsById, publicUrl }: { result: TraceResult; actorsById: Map<string, Actor>; publicUrl: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<ExportFormat | null>(null)
  const [error, setError] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  const run = async (format: ExportFormat) => {
    setOpen(false)
    setBusy(format)
    setError('')
    try {
      const report = buildBatchReport(result, actorsById, publicUrl)
      let blob: Blob
      if (format === 'docx') blob = await (await import('../lib/reports/docx')).buildBatchDocx(report)
      else blob = await (await import('../lib/reports/xlsx')).buildBatchXlsx(report)
      downloadBlob(`${report.fileBase}.${format}`, blob, MIME[format])
    } catch (err) {
      console.error(err)
      setError(`Không xuất được file ${FORMAT_NAMES[format]}. Thử lại sau.`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy !== null}
        aria-expanded={open}
        aria-haspopup="menu"
        className={buttonClass('secondary', 'md')}
      >
        <Download className="w-4 h-4" /> {busy ? `Đang tạo ${FORMAT_NAMES[busy]}...` : 'Xuất báo cáo'} <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 mt-1 w-64 z-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-card-hover p-1">
          {EXPORT_OPTIONS.map((o) => (
            <button
              key={o.format}
              role="menuitem"
              type="button"
              onClick={() => run(o.format)}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <span className="block text-sm text-slate-800 dark:text-slate-100">{o.label}</span>
              <span className="block text-xs text-slate-400 dark:text-slate-500">{o.hint}</span>
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="absolute left-0 mt-1 text-xs text-rose-600 dark:text-rose-400 whitespace-nowrap">
          {error}
        </p>
      )}
    </div>
  )
}

function QrPanel({ batchId, publicUrl }: { batchId: string; publicUrl: string }) {
  const [svg, setSvg] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    batchApi.qrSvg(batchId).then(setSvg).catch(() => {})
  }, [batchId])

  return (
    <div className={cardClass({ className: 'flex flex-col sm:flex-row gap-4 items-center' })}>
      {svg && (
        // Rendered as an <img> (not dangerouslySetInnerHTML) so the SVG markup is
        // never parsed into the live DOM — an <img>-loaded SVG can't run scripts.
        <img
          src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
          alt="Mã QR tra cứu nguồn gốc"
          className="w-32 h-32 rounded-xl ring-1 ring-slate-100 dark:ring-slate-700 bg-white flex-shrink-0"
        />
      )}
      <div className="min-w-0 flex-1 w-full">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Tem truy xuất cho người tiêu dùng</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">In mã QR lên bao bì. Người mua quét sẽ thấy hành trình công khai của lô.</p>
        <div className="flex flex-wrap gap-2 mt-3">
          {svg && (
            <button type="button" onClick={() => downloadBlob(`qr-${batchId.slice(0, 8)}.svg`, svg, MIME.svg)} className={buttonClass('secondary', 'sm')}>
              Tải mã QR
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(publicUrl).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              })
            }}
            className={buttonClass('secondary', 'sm')}
          >
            {copied ? 'Đã sao chép' : 'Sao chép link'}
          </button>
          <a href={publicUrl} target="_blank" rel="noreferrer" className={buttonClass('ghost', 'sm')}>
            Xem trang công khai <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  )
}

export default function BatchDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { actor } = useAuth()
  const [result, setResult] = useState<TraceResult | null>(null)
  const [actors, setActors] = useState<Actor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [recallOpen, setRecallOpen] = useState(false)
  const [flash, setFlash] = useState<string>((location.state as { flash?: string } | null)?.flash ?? '')

  const load = useCallback(() => {
    if (!id) return
    setLoading(true)
    setError('')
    traceApi
      .get(id)
      .then(setResult)
      .catch((err) => setError(apiErrorMessage(err, 'Không thể tải thông tin lô hàng.')))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    load()
    actorsApi.list().then(setActors).catch(() => {})
  }, [load])

  const actorsById = useMemo(() => new Map(actors.map((a) => [a.id, a])), [actors])
  const canRecall = actor?.role === 'ADMIN' || actor?.role === 'INSPECTOR'

  // Arriving from a failed quality check: offer the recall straight away.
  useEffect(() => {
    if (searchParams.get('recall') === 'suggest' && result && canRecall && !result.batch.isRecalled) setRecallOpen(true)
  }, [searchParams, result, canRecall])

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(''), 4000)
    return () => clearTimeout(t)
  }, [flash])

  const closeRecall = () => {
    setRecallOpen(false)
    if (searchParams.has('recall')) setSearchParams({}, { replace: true })
  }

  const header = (title: string, right?: ReactNode) => (
    <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label="Quay lại"
        className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>
      <h1 className="font-semibold text-slate-900 dark:text-slate-50 flex-1 truncate">{title}</h1>
      {right}
    </header>
  )

  if (loading && !result) {
    return (
      <div className="page-shell">
        <main className="page-container space-y-4">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-32 w-full" />
          <SkeletonCardList rows={4} />
        </main>
      </div>
    )
  }

  if (error || !result) {
    return (
      <div className="page-shell">
        {header('Lô hàng')}
        <main className="page-container">
          <div className={cardClass({ className: 'text-center py-10' })}>
            <p className="text-rose-500 dark:text-rose-400 text-sm mb-4">{error || 'Không tìm thấy lô hàng.'}</p>
            <Link to="/dashboard" className={buttonClass('secondary', 'sm')}>
              Về tổng quan
            </Link>
          </div>
        </main>
      </div>
    )
  }

  const { batch, events, anomalies, isValid } = result
  const publicUrl = `${window.location.origin}/provenance/${batch.id}`
  const next = nextStageOf(batch)
  const custodian = batch.assignedToActorId ? actorsById.get(batch.assignedToActorId) : undefined
  const mine = actor ? canActOn(actor, batch) : false
  const openAnomalies = anomalies.filter((a) => !a.resolved)
  const waitingSince = batch.lastEventAt ?? batch.createdAt

  return (
    <div className="page-shell">
      {header(batch.productName, <VerifyBadge isValid={isValid} hasAnomalies={openAnomalies.length > 0} />)}

      <main className="page-container space-y-4">
        {flash && (
          <div role="status" className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-800 dark:text-emerald-300 text-sm rounded-xl px-3.5 py-2.5 flex items-center gap-2 animate-scale-in">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> {flash}
          </div>
        )}

        {batch.isRecalled && (
          <div className="bg-rose-50 dark:bg-rose-500/10 border-2 border-rose-200 dark:border-rose-500/30 rounded-2xl p-4 text-rose-800 dark:text-rose-300 flex gap-3">
            <Siren className="w-5 h-5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-semibold">Lô hàng đã bị thu hồi</p>
              <p className="mt-0.5">{batch.recallReason}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <div className="xl:col-span-2 space-y-4 min-w-0">
        {/* Status: what is it, where is it, who has it, what's next */}
        <section className={cardClass({ className: 'space-y-4' })}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {batch.productType} · {batch.origin}
              </p>
              <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                {batch.quantity.toLocaleString('vi-VN')} {batch.unit}
              </p>
            </div>
            <Badge tone={batch.isRecalled ? 'danger' : next ? 'brand' : 'success'}>
              {batch.isRecalled ? 'Đã thu hồi' : next ? `Chờ ${STAGE_LABELS[next].toLowerCase()}` : 'Đã hoàn tất'}
            </Badge>
          </div>

          <StageProgress current={batch.currentStage} recalled={batch.isRecalled} />

          {!batch.isRecalled && next && (
            <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
              <p className="text-sm text-slate-600 dark:text-slate-300 flex items-center gap-1.5 min-w-0">
                <Clock3 className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <span>
                  {mine ? (
                    <strong className="text-brand-700 dark:text-brand-400">Đang chờ bạn</strong>
                  ) : custodian ? (
                    <>
                      Đang chờ <strong>{custodian.organization}</strong> ({ROLE_LABELS[custodian.role].toLowerCase()})
                    </>
                  ) : (
                    'Chưa giao cho ai'
                  )}{' '}
                  · từ {relativeDays(waitingSince)}
                </span>
              </p>
              {mine && (
                <Link to={`/record?batchId=${batch.id}`} className={buttonClass('primary', 'md')}>
                  Xử lý: {STAGE_LABELS[next]}
                </Link>
              )}
            </div>
          )}
        </section>

        {openAnomalies.length > 0 && (
          <section className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-2xl p-4">
            <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-400 mb-2">Cảnh báo chưa xử lý ({openAnomalies.length})</h2>
            <ul className="space-y-1">
              {openAnomalies.map((a) => (
                <li key={a.id} className="text-sm text-amber-700 dark:text-amber-400/90 flex gap-2">
                  <TriangleAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{a.message}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <Timeline events={events} actorsById={actorsById} />
        </div>

        {/* Side column: what you can do with this lot. */}
        <aside className="space-y-4 min-w-0">
        <div className="flex gap-2 flex-wrap items-center">
          <ExportMenu result={result} actorsById={actorsById} publicUrl={publicUrl} />
        </div>

        {actor && !batch.isRecalled && next && !mine && batch.assignedToActorId === actor.id && batch.consumedQuantity < batch.quantity && (
          <HandOffPanel
            batch={batch}
            actors={actors}
            onDone={() => {
              setFlash('Đã bàn giao lô hàng.')
              load()
            }}
          />
        )}

        <LineagePanel batch={batch} />

        <QrPanel batchId={batch.id} publicUrl={publicUrl} />

        <VerifyPanel batchId={batch.id} />

        {canRecall && !batch.isRecalled && (
          <section className={cardClass({ className: 'border-rose-200/80 dark:border-rose-500/20' })}>
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Thu hồi lô hàng</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-3">
              Dừng mọi khâu tiếp theo, báo cho các đối tác và hiển thị cảnh báo trên trang công khai. Không thể hoàn tác.
            </p>
            <button type="button" onClick={() => setRecallOpen(true)} className={buttonClass('danger', 'sm')}>
              Thu hồi lô hàng…
            </button>
          </section>
        )}

        <p className="text-[11px] text-slate-300 dark:text-slate-600 font-mono break-all">Mã lô: {batch.id}</p>
        </aside>
        </div>
      </main>

      <RecallDialog
        batch={batch}
        open={recallOpen}
        onClose={closeRecall}
        initialReason={searchParams.get('recall') === 'suggest' ? 'Không đạt kiểm định chất lượng' : undefined}
        onRecalled={() => {
          closeRecall()
          setFlash('Đã thu hồi lô hàng và thông báo cho các đối tác.')
          load()
        }}
      />
    </div>
  )
}
