import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Clock3, TriangleAlert } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { batchApi, traceApi, actorsApi, ActorDetail, TraceResult, STAGE_ICONS, STAGE_LABELS, ROLE_LABELS } from '../api/client'
import Timeline from '../components/Timeline'
import VerifyBadge from '../components/VerifyBadge'
import { buttonClass } from '../components/ui/Button'
import { cardClass } from '../components/ui/Card'
import { Skeleton, SkeletonCardList } from '../components/ui/Skeleton'

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function eventsToCsv(result: TraceResult): string {
  const header = ['sequenceNumber', 'stage', 'actorId', 'timestamp', 'location', 'notes', 'hash', 'prevHash']
  const rows = result.events.map((e) =>
    [e.sequenceNumber, e.stage, e.actorId, e.timestamp, e.location, e.notes ?? '', e.hash, e.prevHash]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  )
  return [header.join(','), ...rows].join('\n')
}

async function downloadPdf(result: TraceResult) {
  // Loaded on demand — jsPDF (with its embedded font tables) is ~400KB and
  // only needed if someone actually clicks "Xuất PDF", so every other visit
  // to this page shouldn't pay for it in the initial bundle.
  const { jsPDF } = await import('jspdf')
  const { batch, events, anomalies, isValid } = result
  const doc = new jsPDF()
  let y = 15

  const line = (text: string, size = 11, gap = 7) => {
    doc.setFontSize(size)
    doc.text(text, 14, y)
    y += gap
  }

  line('TraceChain — Báo cáo hành trình lô hàng', 16, 10)
  line(`Sản phẩm: ${batch.productName} (${batch.productType})`)
  line(`Xuất xứ: ${batch.origin} · Số lượng: ${batch.quantity} ${batch.unit}`)
  line(`Mã lô hàng: ${batch.id}`)
  line(`Chuỗi dữ liệu hợp lệ: ${isValid ? 'Có' : 'KHÔNG — phát hiện can thiệp'}`)
  if (batch.isRecalled) line(`ĐÃ THU HỒI: ${batch.recallReason ?? ''}`)
  y += 3

  line(`Hành trình (${events.length} khâu):`, 13, 8)
  for (const e of events) {
    line(`• ${STAGE_LABELS[e.stage]} — ${e.location} — ${new Date(e.timestamp).toLocaleString('vi-VN')}`, 10, 6)
  }

  if (anomalies.length > 0) {
    y += 3
    line(`Cảnh báo bất thường (${anomalies.length}):`, 13, 8)
    for (const a of anomalies) {
      line(`• [${a.severity}] ${a.message}`, 10, 6)
    }
  }

  doc.save(`hanh-trinh-${batch.id.slice(0, 8)}.pdf`)
}

/**
 * A stylized "map" of the batch's journey by location name. Events don't carry
 * real GPS coordinates (only free-text location strings), so this renders a
 * left-to-right path of named waypoints rather than pretending to plot them
 * on an actual map with fabricated geo-coordinates.
 */
function JourneyMap({ events }: { events: TraceResult['events'] }) {
  if (events.length === 0) return null
  const ordered = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber)

  return (
    <div className={cardClass()}>
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">Hành trình theo địa điểm</h3>
      <div className="flex items-start overflow-x-auto pb-2">
        {ordered.map((e, i) => {
          const StageIcon = STAGE_ICONS[e.stage]
          return (
          <div key={e.id} className="flex items-center flex-shrink-0">
            <div className="flex flex-col items-center w-28 text-center">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-50 to-brand-100 dark:from-brand-500/10 dark:to-brand-500/20 border-2 border-brand-200 dark:border-brand-500/30 flex items-center justify-center text-brand-600 dark:text-brand-400">
                <StageIcon className="w-5 h-5" />
              </div>
              <p className="text-xs font-medium text-slate-800 dark:text-slate-200 mt-1.5 truncate w-full" title={e.location}>
                {e.location}
              </p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">{STAGE_LABELS[e.stage]}</p>
            </div>
            {i < ordered.length - 1 && <div className="w-8 h-px bg-slate-300 dark:bg-slate-700 mt-5 flex-shrink-0" />}
          </div>
          )
        })}
      </div>
    </div>
  )
}

function AssignedToInfo({ actorId }: { actorId: string }) {
  const [detail, setDetail] = useState<ActorDetail | null>(null)

  useEffect(() => {
    setDetail(null)
    actorsApi.detail(actorId).then(setDetail).catch(() => {})
  }, [actorId])

  if (!detail) return null

  return (
    <div className="mt-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl p-3 text-sm text-amber-800 dark:text-amber-400 flex items-center gap-2">
      <Clock3 className="w-4 h-4 flex-shrink-0" />
      <p><strong>Đang chờ xử lý bởi:</strong> {detail.actor.name} · {detail.actor.organization} ({ROLE_LABELS[detail.actor.role]})</p>
    </div>
  )
}

function QrPanel({ batchId }: { batchId: string }) {
  const [svg, setSvg] = useState('')

  useEffect(() => {
    batchApi.qrSvg(batchId).then(setSvg).catch(() => {})
  }, [batchId])

  if (!svg) return null

  return (
    <div className={cardClass({ className: 'flex flex-col items-center gap-3' })}>
      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 self-start">Mã QR tra cứu</p>
      {/* Rendered as an <img> (not dangerouslySetInnerHTML) so the SVG markup is
          never parsed into the live DOM — an <img>-loaded SVG can't execute
          embedded scripts, which closes off the XSS vector even if the QR
          payload ever grows to include unescaped free text. */}
      <img
        src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
        alt="Mã QR tra cứu"
        className="w-40 h-40 rounded-xl ring-1 ring-slate-100 dark:ring-slate-700 bg-white"
      />
      <button
        type="button"
        onClick={() => downloadBlob(`qr-${batchId.slice(0, 8)}.svg`, svg, 'image/svg+xml')}
        className="text-xs text-brand-600 dark:text-brand-400 hover:underline font-medium"
      >
        Tải mã QR (SVG)
      </button>
    </div>
  )
}

export default function BatchDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { actor } = useAuth()
  const [result, setResult] = useState<TraceResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward')
  const [recalling, setRecalling] = useState(false)

  const load = useCallback(() => {
    if (!id) return
    setLoading(true)
    setError('')
    const fn = direction === 'forward' ? traceApi.forward : traceApi.backward
    fn(id)
      .then(setResult)
      .catch(() => setError('Không thể tải thông tin lô hàng'))
      .finally(() => setLoading(false))
  }, [id, direction])

  useEffect(() => {
    load()
  }, [load])

  const handleRecall = async () => {
    if (!id) return
    const reason = window.prompt('Nhập lý do thu hồi lô hàng:')
    if (!reason || !reason.trim()) return
    setRecalling(true)
    try {
      await batchApi.recall(id, reason.trim())
      load()
    } catch {
      window.alert('Thu hồi lô hàng thất bại')
    } finally {
      setRecalling(false)
    }
  }

  if (loading) {
    return (
      <div className="page-shell">
        <main className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-32 w-full" />
          <SkeletonCardList rows={4} />
        </main>
      </div>
    )
  }

  if (error || !result) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-rose-500 dark:text-rose-400 text-sm mb-3">{error || 'Không tìm thấy lô hàng'}</p>
          <button onClick={() => navigate('/dashboard')} className="text-brand-600 dark:text-brand-400 text-sm hover:underline inline-flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Về trang chủ
          </button>
        </div>
      </div>
    )
  }

  const { batch, events, anomalies, isValid } = result
  const publicUrl = `${window.location.origin}/provenance/${batch.id}`

  return (
    <div className="page-shell">
      <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button
          onClick={() => navigate(-1)}
          className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="font-semibold text-slate-900 dark:text-slate-50 flex-1 truncate">{batch.productName}</h1>
        <VerifyBadge isValid={isValid} hasAnomalies={anomalies.length > 0} />
      </header>

      <main className="max-w-2xl mx-auto p-4 space-y-4">
        {/* Batch info card */}
        <div className={cardClass()}>
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Thông tin lô hàng</h2>
          <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
            <div>
              <span className="text-slate-500 dark:text-slate-400">Loại:</span>{' '}
              <span className="font-medium dark:text-slate-200">{batch.productType}</span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Xuất xứ:</span>{' '}
              <span className="font-medium dark:text-slate-200">{batch.origin}</span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Số lượng:</span>{' '}
              <span className="font-medium dark:text-slate-200">{batch.quantity} {batch.unit}</span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Khâu hiện tại:</span>{' '}
              <span className="font-medium dark:text-slate-200">
                {batch.currentStage ? STAGE_LABELS[batch.currentStage] : 'Chưa bắt đầu'}
              </span>
            </div>
          </div>
          {!batch.isRecalled && batch.assignedToActorId && <AssignedToInfo actorId={batch.assignedToActorId} />}
          {batch.isRecalled && (
            <div className="mt-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl p-3 text-sm text-rose-700 dark:text-rose-400">
              <strong>Đã thu hồi:</strong> {batch.recallReason}
            </div>
          )}
          <p className="mt-3 text-xs text-slate-300 dark:text-slate-600 font-mono">ID: {batch.id}</p>
        </div>

        {/* Anomaly warnings */}
        {anomalies.length > 0 && (
          <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-2xl p-4">
            <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-400 mb-2">
              Cảnh báo bất thường ({anomalies.length})
            </h3>
            <ul className="space-y-1">
              {anomalies.map((a, i) => (
                <li key={i} className="text-sm text-amber-700 dark:text-amber-400/90 flex gap-2">
                  <TriangleAlert className="w-4 h-4 flex-shrink-0" />
                  <span>[{a.severity}] {a.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          {/* Direction toggle */}
          <div className="flex rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <button
              onClick={() => setDirection('forward')}
              className={`text-sm px-4 py-2 transition-colors ${
                direction === 'forward' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              Thuận ↓
            </button>
            <button
              onClick={() => setDirection('backward')}
              className={`text-sm px-4 py-2 transition-colors ${
                direction === 'backward' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              Ngược ↑
            </button>
          </div>

          <Link to={`/record?batchId=${batch.id}`} className={buttonClass('secondary', 'md')}>
            + Ghi sự kiện mới
          </Link>

          <button type="button" onClick={() => downloadBlob(`hanh-trinh-${batch.id.slice(0, 8)}.csv`, eventsToCsv(result), 'text/csv')} className={buttonClass('secondary', 'md')}>
            Xuất CSV
          </button>

          <button
            type="button"
            onClick={() =>
              downloadBlob(
                `hanh-trinh-${batch.id.slice(0, 8)}.json`,
                JSON.stringify(result, null, 2),
                'application/json',
              )
            }
            className={buttonClass('secondary', 'md')}
          >
            Xuất JSON
          </button>

          <button type="button" onClick={() => downloadPdf(result)} className={buttonClass('secondary', 'md')}>
            Xuất PDF
          </button>

          {(actor?.role === 'ADMIN' || actor?.role === 'INSPECTOR') && !batch.isRecalled && (
            <button
              type="button"
              disabled={recalling}
              onClick={handleRecall}
              className="text-sm font-medium px-4 py-2.5 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20 transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              {recalling ? 'Đang thu hồi...' : 'Thu hồi lô hàng'}
            </button>
          )}
        </div>

        <JourneyMap events={events} />

        {/* Timeline */}
        <Timeline events={events} />

        <QrPanel batchId={batch.id} />

        {/* Public QR link */}
        <div className={cardClass()}>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Link công khai dành cho người tiêu dùng</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2 text-slate-600 dark:text-slate-300 break-all">
              {publicUrl}
            </code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(publicUrl)}
              className="text-xs text-brand-600 dark:text-brand-400 hover:underline flex-shrink-0 font-medium"
            >
              Sao chép
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
