import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapPin, Upload } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Plot, plotsApi } from '../api/client'
import { apiErrorMessage } from '../lib/apiError'
import { parsePlotFile } from '../lib/geo/importFile'
import PageHeader from '../components/ui/PageHeader'
import Button from '../components/ui/Button'
import { cardClass } from '../components/ui/Card'
import { inputClass, labelClass } from '../components/ui/field'
import EmptyState from '../components/ui/EmptyState'

/** Central Highlands — where most Vietnamese coffee grows. */
const DEFAULT_VIEW: L.LatLngExpression = [12.0, 108.2]

const PLOT_STYLE: L.PathOptions = { color: '#059669', weight: 2, fillOpacity: 0.25 }
const SELECTED_STYLE: L.PathOptions = { color: '#4750e3', weight: 3, fillOpacity: 0.4 }

type ApiErr = { response?: { status?: number; data?: { error?: string } } }

/**
 * Plots (fields) with geolocation — docs/SPEC_PHASE1.md §4. Below 4 ha a
 * plot may be a single point (click the map); larger plots need their
 * boundary, which comes from a survey file (GeoJSON or KML).
 */
export default function Plots() {
  const { actor } = useAuth()
  const canEdit = actor?.role === 'FARMER' || actor?.role === 'ADMIN'
  const [plots, setPlots] = useState<Plot[] | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [areaHa, setAreaHa] = useState('')
  const [point, setPoint] = useState<[number, number] | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const mapEl = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const pickMarker = useRef<L.CircleMarker | null>(null)
  const shapes = useRef(new Map<string, L.GeoJSON>())
  const rows = useRef(new Map<string, HTMLTableRowElement>())
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const load = useCallback(() => {
    plotsApi.list().then(setPlots).catch(() => setPlots([]))
  }, [])
  useEffect(load, [load])

  // Map setup once.
  useEffect(() => {
    if (!mapEl.current || map.current) return
    const m = L.map(mapEl.current, { center: DEFAULT_VIEW, zoom: 8 })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    if (canEdit) {
      m.on('click', (e: L.LeafletMouseEvent) => {
        const lat = Number(e.latlng.lat.toFixed(6))
        const lng = Number(e.latlng.lng.toFixed(6))
        setPoint([lng, lat])
        pickMarker.current?.remove()
        pickMarker.current = L.circleMarker([lat, lng], { radius: 8, color: '#4750e3', weight: 3 }).addTo(m)
      })
    }
    map.current = m
    return () => {
      m.remove()
      map.current = null
    }
  }, [canEdit])

  // Draw plots whenever the list changes.
  useEffect(() => {
    if (!map.current || !layer.current || !plots) return
    layer.current.clearLayers()
    shapes.current.clear()
    const drawn = plots.map((p) => {
      const g = L.geoJSON(p.geometry as never, {
        style: PLOT_STYLE,
        pointToLayer: (_f, latlng) => L.circleMarker(latlng, { radius: 6, fillOpacity: 0.6 }),
      })
      g.bindTooltip(`${p.code} · ${p.name} · ${p.areaHa.toLocaleString('vi-VN')} ha`)
      // Clicking a plot selects it (and must not also drop a new pick marker).
      g.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e)
        setSelectedId(p.id)
        rows.current.get(p.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      })
      g.addTo(layer.current!)
      shapes.current.set(p.id, g)
      return g
    })
    if (drawn.length > 0) {
      const bounds = L.featureGroup(drawn).getBounds()
      if (bounds.isValid()) map.current.fitBounds(bounds.pad(0.3), { maxZoom: 15 })
    }
  }, [plots])

  // Highlight the selected plot on the map.
  useEffect(() => {
    shapes.current.forEach((g, id) => g.setStyle(id === selectedId ? SELECTED_STYLE : PLOT_STYLE))
    shapes.current.get(selectedId ?? '')?.bringToFront()
  }, [selectedId, plots])

  /** Row click → fly the map to that plot and show its label. */
  const focusPlot = (id: string) => {
    const g = shapes.current.get(id)
    if (!map.current || !g) return
    setSelectedId(id)
    const bounds = g.getBounds()
    if (bounds.isValid()) map.current.flyToBounds(bounds.pad(0.5), { maxZoom: 17, duration: 0.8 })
    g.openTooltip(bounds.getCenter())
    mapEl.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  const reset = () => {
    setCode('')
    setName('')
    setAreaHa('')
    setPoint(null)
    pickMarker.current?.remove()
  }

  const addPoint = async (e: FormEvent) => {
    e.preventDefault()
    if (!point) return
    setBusy(true)
    setMessage(null)
    try {
      await plotsApi.create({ code: code.trim(), name: name.trim(), geometry: { type: 'Point', coordinates: point }, declaredAreaHa: Number(areaHa) })
      setMessage({ tone: 'ok', text: `Đã thêm lô đất ${code}.` })
      reset()
      load()
    } catch (err) {
      setMessage({ tone: 'error', text: (err as ApiErr)?.response?.status === 422 ? plotError(err) : apiErrorMessage(err, 'Không thêm được lô đất.') })
    } finally {
      setBusy(false)
    }
  }

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setMessage(null)
    try {
      const fc = parsePlotFile(file.name, await file.text())
      const { results } = await plotsApi.import(fc)
      const ok = results.filter((r) => r.plot).length
      const failed = results.filter((r) => r.error)
      setMessage({
        tone: failed.length ? 'error' : 'ok',
        text:
          `Đã nhập ${ok}/${results.length} lô đất.` +
          (failed.length ? ` Lỗi: ${failed.slice(0, 3).map((f) => `#${f.index + 1} ${translatePlotError(f.error ?? '')}`).join('; ')}` : ''),
      })
      load()
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Không đọc được tệp.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-shell">
      <main className="page-container space-y-4">
        <PageHeader
          title="Vùng trồng"
          subtitle="Toạ độ và ranh giới các lô đất — nền tảng để truy ngược mỗi lô hàng về nơi trồng."
          action={
            canEdit && (
              <label className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2.5 rounded-xl bg-brand-600 text-white hover:bg-brand-700 cursor-pointer">
                <Upload className="w-4 h-4" /> Nhập GeoJSON / KML
                <input type="file" accept=".geojson,.json,.kml" onChange={importFile} className="sr-only" disabled={busy} />
              </label>
            )
          }
        />

        {message && (
          <div role={message.tone === 'error' ? 'alert' : 'status'} className={`text-sm rounded-xl px-3.5 py-2.5 border ${message.tone === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-300' : 'bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400'}`}>
            {message.text}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className={cardClass({ padding: 'none', className: 'lg:col-span-2 overflow-hidden' })}>
            <div ref={mapEl} className="h-[420px] lg:h-[62vh] w-full scroll-mt-20" aria-label="Bản đồ vùng trồng" />
          </div>

          {canEdit && (
            <form onSubmit={addPoint} className={cardClass({ className: 'space-y-3' })}>
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-brand-500" /> Thêm lô đất nhỏ (dưới 4 ha)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Bấm vào bản đồ để chọn vị trí. Lô từ 4 ha trở lên bắt buộc có ranh giới — hãy nhập tệp GeoJSON/KML từ ứng dụng đo đạc.
              </p>
              <div>
                <label className={labelClass} htmlFor="plot-code">Mã lô</label>
                <input id="plot-code" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={60} className={inputClass} placeholder="VD: LT-017" />
              </div>
              <div>
                <label className={labelClass} htmlFor="plot-name">Tên</label>
                <input id="plot-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} className={inputClass} placeholder="VD: Vườn nhà ông Ba" />
              </div>
              <div>
                <label className={labelClass} htmlFor="plot-area">Diện tích (ha)</label>
                <input id="plot-area" type="number" min="0.01" max="3.99" step="0.01" value={areaHa} onChange={(e) => setAreaHa(e.target.value)} required className={inputClass} />
              </div>
              <p className="text-xs font-mono text-slate-500">{point ? `${point[1]}, ${point[0]}` : 'Chưa chọn vị trí'}</p>
              <Button type="submit" disabled={busy || !point} className="w-full">
                Thêm lô đất
              </Button>
            </form>
          )}
        </div>

        <section className={cardClass({ padding: 'none', className: 'overflow-hidden' })}>
          {plots && plots.length === 0 ? (
            <EmptyState icon={<MapPin className="w-6 h-6" />} title="Chưa có lô đất nào" description={canEdit ? 'Thêm lô đất đầu tiên trên bản đồ hoặc nhập tệp.' : undefined} />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Mã</th>
                  <th className="px-4 py-2 font-medium">Tên</th>
                  <th className="px-4 py-2 font-medium text-right">Diện tích</th>
                  <th className="px-4 py-2 font-medium">Dạng</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {(plots ?? []).map((p) => (
                  <tr
                    key={p.id}
                    ref={(el) => {
                      if (el) rows.current.set(p.id, el)
                      else rows.current.delete(p.id)
                    }}
                    tabIndex={0}
                    aria-selected={p.id === selectedId}
                    title="Xem trên bản đồ"
                    onClick={() => focusPlot(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        focusPlot(p.id)
                      }
                    }}
                    className={`cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${p.id === selectedId ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
                  >
                    <td className="px-4 py-2 font-mono">
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className={`w-3.5 h-3.5 ${p.id === selectedId ? 'text-brand-500' : 'text-slate-300 dark:text-slate-600'}`} aria-hidden="true" />
                        {p.code}
                      </span>
                    </td>
                    <td className="px-4 py-2">{p.name}</td>
                    <td className="px-4 py-2 text-right">{p.areaHa.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ha</td>
                    <td className="px-4 py-2 text-slate-500">{p.shape === 'polygon' ? 'Ranh giới' : 'Điểm'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  )
}

const PLOT_ERRORS: Array<[RegExp, string]> = [
  [/Invalid GeoJSON/, 'dữ liệu toạ độ không hợp lệ'],
  [/Only Point, Polygon/, 'chỉ hỗ trợ điểm hoặc đa giác'],
  [/not a valid polygon/, 'ranh giới tự cắt nhau hoặc không khép kín'],
  [/outside Vietnam/, 'nằm ngoài lãnh thổ Việt Nam'],
  [/overlaps/, 'chồng lấn lô đất khác'],
  [/4 ha or more/, 'lô từ 4 ha phải có ranh giới'],
  [/declared area/, 'thiếu diện tích'],
  [/code already/, 'mã lô đã tồn tại'],
]

function translatePlotError(raw: string): string {
  for (const [re, text] of PLOT_ERRORS) if (re.test(raw)) return text
  return raw
}

function plotError(err: unknown): string {
  return `Không thêm được: ${translatePlotError((err as ApiErr)?.response?.data?.error ?? '')}.`
}
