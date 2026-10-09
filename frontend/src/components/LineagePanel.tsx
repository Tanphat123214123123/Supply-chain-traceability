import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowUpLeft, GitFork, MapPinned } from 'lucide-react'
import { Batch, lineageApi, LineageGraph, TRANSFORMATION_LABELS } from '../api/client'
import { MIME, downloadBlob } from '../lib/reports/download'
import { buttonClass } from './ui/Button'
import { cardClass } from './ui/Card'

const fmt = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 3 })

/**
 * Where this lot came from and where it went (docs/SPEC_PHASE1.md §3), plus
 * the plots behind it as GeoJSON for an EUDR due-diligence statement.
 */
export default function LineagePanel({ batch }: { batch: Batch }) {
  const [graph, setGraph] = useState<LineageGraph | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    lineageApi.graph(batch.id).then(setGraph).catch(() => setGraph(null))
  }, [batch.id, batch.consumedQuantity])

  if (!graph) return null
  const parents = graph.upstream.filter((e) => e.toLotId === batch.id)
  const children = graph.downstream.filter((e) => e.fromLotId === batch.id)
  const plotCount = new Set(graph.rootLotIds.map((id) => graph.lots[id]?.plotId).filter(Boolean)).size
  if (parents.length === 0 && children.length === 0 && plotCount === 0) return null

  const downloadPlots = async () => {
    setDownloading(true)
    setError('')
    try {
      const text = await lineageApi.plotsGeoJson(batch.id)
      downloadBlob(`vung-trong-${batch.id.slice(0, 8)}.geojson`, new Blob([text], { type: MIME.geojson }), MIME.geojson)
    } catch {
      setError('Không tải được dữ liệu vùng trồng.')
    } finally {
      setDownloading(false)
    }
  }

  const lot = (id: string) => graph.lots[id]

  return (
    <section className={cardClass({ className: 'space-y-3' })}>
      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
        <GitFork className="w-4 h-4 text-brand-500" /> Phả hệ lô hàng
      </h2>

      {parents.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1">
            <ArrowUpLeft className="w-3.5 h-3.5" /> Tạo từ {TRANSFORMATION_LABELS[parents[0].kind].toLowerCase()} {parents.length} lô
            {graph.rootLotIds.length > parents.length && ` — tổng cộng ${graph.rootLotIds.length} lô thu hoạch gốc`}
          </p>
          <ul className="text-sm space-y-1 max-h-48 overflow-y-auto">
            {parents.map((e) => (
              <li key={e.fromLotId} className="flex justify-between gap-2">
                <Link to={`/batch/${e.fromLotId}`} className="text-brand-700 dark:text-brand-400 hover:underline truncate">
                  {lot(e.fromLotId)?.productName ?? e.fromLotId.slice(0, 8)}
                </Link>
                <span className="text-slate-500 whitespace-nowrap">
                  {fmt(e.quantity)} {e.unit}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(children.length > 0 || batch.consumedQuantity > 0) && (
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1">
            <ArrowDownRight className="w-3.5 h-3.5" /> Đã chuyển {fmt(batch.consumedQuantity)}/{fmt(batch.quantity)} {batch.unit}
            {batch.consumedQuantity >= batch.quantity && ' — lô đã dùng hết'}
          </p>
          <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden mb-2">
            <div className="h-full bg-brand-500" style={{ width: `${Math.min(100, (batch.consumedQuantity / batch.quantity) * 100)}%` }} />
          </div>
          <ul className="text-sm space-y-1">
            {children.map((e) => (
              <li key={`${e.transformationId}-${e.toLotId}`} className="flex justify-between gap-2">
                <Link to={`/batch/${e.toLotId}`} className="text-brand-700 dark:text-brand-400 hover:underline truncate">
                  {TRANSFORMATION_LABELS[e.kind]} → {lot(e.toLotId)?.productName ?? e.toLotId.slice(0, 8)}
                </Link>
                <span className="text-slate-500 whitespace-nowrap">
                  {fmt(e.quantity)} {e.unit}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plotCount > 0 && (
        <div className="flex items-center justify-between gap-2 flex-wrap pt-1 border-t border-slate-100 dark:border-slate-800">
          <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <MapPinned className="w-3.5 h-3.5" /> {plotCount} lô đất có toạ độ
          </p>
          <button type="button" onClick={downloadPlots} disabled={downloading} className={buttonClass('secondary', 'sm')}>
            {downloading ? 'Đang tải...' : 'Tải GeoJSON vùng trồng (EUDR)'}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </section>
  )
}
