import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { batchApi, traceApi, TraceResult, STAGE_LABELS } from '../api/client'
import Timeline from '../components/Timeline'
import VerifyBadge from '../components/VerifyBadge'

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

function QrPanel({ batchId }: { batchId: string }) {
  const [svg, setSvg] = useState('')

  useEffect(() => {
    batchApi.qrSvg(batchId).then(setSvg).catch(() => {})
  }, [batchId])

  if (!svg) return null

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col items-center gap-2">
      <p className="text-sm font-medium text-gray-700 self-start">Mã QR tra cứu</p>
      {/* eslint-disable-next-line react/no-danger */}
      <div className="w-40 h-40" dangerouslySetInnerHTML={{ __html: svg }} />
      <button
        type="button"
        onClick={() => downloadBlob(`qr-${batchId.slice(0, 8)}.svg`, svg, 'image/svg+xml')}
        className="text-xs text-blue-600 hover:underline"
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
      <div className="flex h-screen items-center justify-center text-gray-400 text-sm">
        Đang tải...
      </div>
    )
  }

  if (error || !result) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 text-sm mb-3">{error || 'Không tìm thấy lô hàng'}</p>
          <button onClick={() => navigate('/')} className="text-blue-600 text-sm hover:underline">
            ← Về trang chủ
          </button>
        </div>
      </div>
    )
  }

  const { batch, events, anomalies, isValid } = result
  const publicUrl = `${window.location.origin}/provenance/${batch.id}`

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button
          onClick={() => navigate(-1)}
          className="text-gray-500 hover:text-gray-800 text-xl leading-none"
        >
          ←
        </button>
        <h1 className="font-semibold text-gray-900 flex-1 truncate">{batch.productName}</h1>
        <VerifyBadge isValid={isValid} hasAnomalies={anomalies.length > 0} />
      </header>

      <main className="max-w-2xl mx-auto p-4 space-y-4">
        {/* Batch info card */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Thông tin lô hàng</h2>
          <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
            <div>
              <span className="text-gray-500">Loại:</span>{' '}
              <span className="font-medium">{batch.productType}</span>
            </div>
            <div>
              <span className="text-gray-500">Xuất xứ:</span>{' '}
              <span className="font-medium">{batch.origin}</span>
            </div>
            <div>
              <span className="text-gray-500">Số lượng:</span>{' '}
              <span className="font-medium">{batch.quantity} {batch.unit}</span>
            </div>
            <div>
              <span className="text-gray-500">Khâu hiện tại:</span>{' '}
              <span className="font-medium">
                {batch.currentStage ? STAGE_LABELS[batch.currentStage] : 'Chưa bắt đầu'}
              </span>
            </div>
          </div>
          {batch.isRecalled && (
            <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              <strong>Đã thu hồi:</strong> {batch.recallReason}
            </div>
          )}
          <p className="mt-3 text-xs text-gray-300 font-mono">ID: {batch.id}</p>
        </div>

        {/* Anomaly warnings */}
        {anomalies.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-amber-800 mb-2">
              Cảnh báo bất thường ({anomalies.length})
            </h3>
            <ul className="space-y-1">
              {anomalies.map((a, i) => (
                <li key={i} className="text-sm text-amber-700 flex gap-2">
                  <span className="flex-shrink-0">⚠</span>
                  <span>[{a.severity}] {a.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          {/* Direction toggle */}
          <div className="flex rounded-lg overflow-hidden border border-gray-200 bg-white">
            <button
              onClick={() => setDirection('forward')}
              className={`text-sm px-4 py-2 transition-colors ${
                direction === 'forward'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              Thuận ↓
            </button>
            <button
              onClick={() => setDirection('backward')}
              className={`text-sm px-4 py-2 transition-colors ${
                direction === 'backward'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              Ngược ↑
            </button>
          </div>

          <Link
            to={`/record?batchId=${batch.id}`}
            className="text-sm bg-white border border-gray-200 hover:border-blue-300
                       text-gray-700 px-4 py-2 rounded-lg transition-colors"
          >
            + Ghi sự kiện mới
          </Link>

          <button
            type="button"
            onClick={() => downloadBlob(`hanh-trinh-${batch.id.slice(0, 8)}.csv`, eventsToCsv(result), 'text/csv')}
            className="text-sm bg-white border border-gray-200 hover:border-blue-300
                       text-gray-700 px-4 py-2 rounded-lg transition-colors"
          >
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
            className="text-sm bg-white border border-gray-200 hover:border-blue-300
                       text-gray-700 px-4 py-2 rounded-lg transition-colors"
          >
            Xuất JSON
          </button>

          {actor?.role === 'ADMIN' && !batch.isRecalled && (
            <button
              type="button"
              disabled={recalling}
              onClick={handleRecall}
              className="text-sm bg-red-50 border border-red-200 hover:bg-red-100
                         text-red-600 px-4 py-2 rounded-lg transition-colors disabled:opacity-60"
            >
              {recalling ? 'Đang thu hồi...' : 'Thu hồi lô hàng'}
            </button>
          )}
        </div>

        {/* Timeline */}
        <Timeline events={events} />

        <QrPanel batchId={batch.id} />

        {/* Public QR link */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm font-medium text-gray-700 mb-2">Link công khai dành cho người tiêu dùng</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-gray-600 break-all">
              {publicUrl}
            </code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(publicUrl)}
              className="text-xs text-blue-600 hover:underline flex-shrink-0"
            >
              Sao chép
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
