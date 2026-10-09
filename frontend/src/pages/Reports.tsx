import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Check, CircleAlert, CircleCheck, Download, FilterX } from 'lucide-react'
import { ANOMALY_TYPE_LABELS, batchApi, ReportData, STAGE_LABELS, statsApi } from '../api/client'
import { ChartCard, ChartTooltip, DataBarCell, KpiCard, RingMeter } from '../components/report/ReportParts'
import { fmtCompact, fmtDuration, fmtNumber, fmtPercent, useChartTheme } from '../components/report/chartTheme'
import { apiErrorMessage } from '../lib/apiError'
import { downloadBlob, MIME } from '../lib/reports/download'

/** Template chrome (the navy of the chosen dashboard style). */
const NAVY = '#2b3d6f'

const PRESETS = [
  { days: 30, label: '30 ngày qua' },
  { days: 90, label: '90 ngày qua' },
  { days: 180, label: '6 tháng qua' },
  { days: 365, label: '12 tháng qua' },
] as const

type Metric = 'batches' | 'volumeKg' | 'events'
const METRICS: Record<Metric, { label: string; unit: string }> = {
  batches: { label: 'Lô hàng', unit: 'lô' },
  volumeKg: { label: 'Khối lượng', unit: 'kg' },
  events: { label: 'Sự kiện', unit: 'sự kiện' },
}

const fmtDate = (iso: string | Date) => new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
const fmtMonth = (ym: string) => {
  const [y, m] = ym.split('-')
  return `T${Number(m)}/${y.slice(2)}`
}
const dayStartIso = (d: string) => new Date(`${d}T00:00:00`).toISOString()
const dayEndIso = (d: string) => new Date(`${d}T23:59:59.999`).toISOString()

const axisTick = (fill: string) => ({ fill, fontSize: 11 })

/** Single-line value label at the end of a horizontal bar (recharts' default wraps short labels). */
const valueLabel =
  (format: (v: number) => string, fill: string) =>
  (props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: number | string }) => {
    const x = Number(props.x) + Number(props.width) + 6
    const y = Number(props.y) + Number(props.height) / 2
    return (
      <text x={x} y={y} fill={fill} fontSize={11} dominantBaseline="central" className="tabular-nums">
        {format(Number(props.value))}
      </text>
    )
  }

/**
 * Operations dashboard (template: "Supply and Sales Analysis"): a navy filter
 * column on the left scopes every tile, chart and table on the right.
 */
export default function Reports() {
  const theme = useChartTheme()
  const [preset, setPreset] = useState<number | 'custom'>(180)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [productType, setProductType] = useState('')
  const [origin, setOrigin] = useState('')
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [metric, setMetric] = useState<Metric>('batches')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  const range = useMemo(() => {
    if (preset === 'custom') {
      return { from: customFrom ? dayStartIso(customFrom) : undefined, to: customTo ? dayEndIso(customTo) : undefined }
    }
    const to = new Date()
    return { from: new Date(to.getTime() - preset * 24 * 3600 * 1000).toISOString(), to: to.toISOString() }
  }, [preset, customFrom, customTo])

  const load = useCallback(() => {
    if (preset === 'custom' && (!customFrom || !customTo || customFrom > customTo)) return
    setLoading(true)
    setError('')
    statsApi
      .report({ ...range, productType: productType || undefined, origin: origin || undefined })
      .then(setData)
      .catch((err) => setError(apiErrorMessage(err, 'Không tải được báo cáo.')))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, productType, origin])

  useEffect(load, [load])

  const clearFilters = () => {
    setPreset(180)
    setCustomFrom('')
    setCustomTo('')
    setProductType('')
    setOrigin('')
  }

  const handleExport = async () => {
    setExporting(true)
    setExportError('')
    try {
      const batches = (await batchApi.exportJson({ from: range.from, to: range.to, origin: origin || undefined })).filter(
        (b) => !productType || b.productType === productType,
      )
      const { buildBatchListXlsx } = await import('../lib/reports/xlsx')
      const blob = await buildBatchListXlsx(batches, {
        from: range.from?.slice(0, 10),
        to: range.to?.slice(0, 10),
        origin,
      })
      downloadBlob(`bao-cao-lo-hang-${new Date().toISOString().slice(0, 10)}.xlsx`, blob, MIME.xlsx)
    } catch (err) {
      setExportError(apiErrorMessage(err, 'Xuất báo cáo thất bại.'))
    } finally {
      setExporting(false)
    }
  }

  const k = data?.kpis
  const monthlyMax = useMemo(
    () => ({
      batches: Math.max(0, ...(data?.monthly ?? []).map((m) => m.batches)),
      volumeKg: Math.max(0, ...(data?.monthly ?? []).map((m) => m.volumeKg)),
    }),
    [data],
  )
  const totals = useMemo(
    () =>
      (data?.monthly ?? []).reduce(
        (t, m) => ({ batches: t.batches + m.batches, events: t.events + m.events, volumeKg: t.volumeKg + m.volumeKg, recalls: t.recalls + m.recalls, anomalies: t.anomalies + m.anomalies }),
        { batches: 0, events: 0, volumeKg: 0, recalls: 0, anomalies: 0 },
      ),
    [data],
  )
  const orgMax = Math.max(0, ...(data?.organizations ?? []).map((o) => o.events))
  const originMax = Math.max(0, ...(data?.byOrigin ?? []).map((o) => o.batches))

  const selectClass =
    'w-full rounded-lg bg-white/10 border border-white/20 text-white text-sm px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-white/40 [&>option]:text-slate-900'

  return (
    <div className="page-shell">
      <div className="flex flex-col lg:flex-row min-h-[calc(100vh-3.5rem)]">
        {/* ── Filter column ── */}
        <aside
          className="lg:w-64 flex-shrink-0 text-white p-5 space-y-5 lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:overflow-y-auto"
          style={{ background: NAVY }}
          aria-label="Bộ lọc báo cáo"
        >
          <div>
            <p className="text-lg font-semibold">Báo cáo</p>
            <p className="text-xs text-white/60">Mọi số liệu bên phải theo bộ lọc này</p>
          </div>

          <div>
            <p className="text-xs font-medium text-white/70 mb-1.5">Khoảng thời gian</p>
            <ul className="space-y-0.5" role="listbox" aria-label="Khoảng thời gian">
              {[...PRESETS, { days: 'custom' as const, label: 'Tuỳ chọn…' }].map((p) => {
                const selected = preset === p.days
                return (
                  <li key={String(p.days)}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => setPreset(p.days)}
                      className={`w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm transition-colors ${selected ? 'bg-white/15 font-semibold' : 'hover:bg-white/5 text-white/85'}`}
                    >
                      {p.label}
                      {selected && <Check className="w-4 h-4" strokeWidth={3} />}
                    </button>
                  </li>
                )
              })}
            </ul>
            {preset === 'custom' && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <label className="text-[11px] text-white/70">
                  Từ
                  <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className={`${selectClass} mt-0.5 [color-scheme:dark]`} />
                </label>
                <label className="text-[11px] text-white/70">
                  Đến
                  <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className={`${selectClass} mt-0.5 [color-scheme:dark]`} />
                </label>
              </div>
            )}
          </div>

          <label className="block">
            <span className="text-xs font-medium text-white/70">Loại hàng</span>
            <select value={productType} onChange={(e) => setProductType(e.target.value)} className={`${selectClass} mt-1`}>
              <option value="">Tất cả</option>
              {data?.options.productTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-white/70">Vùng / xuất xứ</span>
            <select value={origin} onChange={(e) => setOrigin(e.target.value)} className={`${selectClass} mt-1`}>
              <option value="">Tất cả</option>
              {data?.options.origins.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>

          <button type="button" onClick={clearFilters} className="w-full inline-flex items-center justify-center gap-1.5 rounded-full border border-white/40 px-3 py-2 text-sm hover:bg-white/10">
            <FilterX className="w-4 h-4" /> Xoá bộ lọc
          </button>

          <div className="border-t border-white/15 pt-4">
            <button type="button" onClick={handleExport} disabled={exporting} className="w-full inline-flex items-center justify-center gap-1.5 rounded-full bg-white text-[#2b3d6f] font-medium px-3 py-2 text-sm hover:bg-white/90 disabled:opacity-60">
              <Download className="w-4 h-4" /> {exporting ? 'Đang tạo...' : 'Xuất Excel (.xlsx)'}
            </button>
            {exportError && <p role="alert" className="text-xs text-rose-200 mt-2">{exportError}</p>}
          </div>
        </aside>

        {/* ── Dashboard ── */}
        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-5 space-y-4">
          <header className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[#2b3d6f] dark:text-slate-50">Báo cáo vận hành chuỗi cung ứng</h1>
              {data && (
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {fmtDate(data.window.from)} – {fmtDate(data.window.to)} · so với kỳ liền trước cùng độ dài
                </p>
              )}
            </div>
          </header>

          {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
          {!data && loading && <p className="text-sm text-slate-500">Đang tải báo cáo…</p>}

          {data && k && (
            <div className={`space-y-4 transition-opacity ${loading ? 'opacity-50' : ''}`} aria-busy={loading}>
              {/* KPI row */}
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                <KpiCard label="Lô hàng mới" value={fmtCompact(k.batches.value)} kpi={k.batches} />
                <KpiCard label="Khối lượng (kg)" value={fmtCompact(k.volumeKg.value)} kpi={k.volumeKg} />
                <KpiCard label="Sự kiện ghi nhận" value={fmtCompact(k.events.value)} kpi={k.events} />
                <KpiCard label="Tỉ lệ thu hồi" value={fmtPercent(k.recallRate.value)} kpi={k.recallRate} upIsGood={false} />
                <KpiCard label="Cảnh báo chưa xử lý" value={fmtNumber(k.openAnomalies.value)} kpi={k.openAnomalies} upIsGood={false} />
                <KpiCard
                  label="Thời gian đến kệ (TB)"
                  value={k.avgLeadTimeDays.value ? fmtDuration(k.avgLeadTimeDays.value * 24) : '—'}
                  kpi={k.avgLeadTimeDays}
                  upIsGood={false}
                />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                {/* Monthly trend */}
                <ChartCard
                  className="xl:col-span-6"
                  title="Diễn biến theo tháng"
                  subtitle={`${METRICS[metric].label} mỗi tháng`}
                  action={
                    <div role="tablist" className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
                      {(Object.keys(METRICS) as Metric[]).map((m) => (
                        <button
                          key={m}
                          role="tab"
                          aria-selected={metric === m}
                          type="button"
                          onClick={() => setMetric(m)}
                          className={`px-2.5 py-1 ${metric === m ? 'bg-[#2b3d6f] text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                        >
                          {METRICS[m].label}
                        </button>
                      ))}
                    </div>
                  }
                >
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.monthly} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid vertical={false} stroke={theme.grid} />
                        <XAxis dataKey="month" tickFormatter={fmtMonth} tick={axisTick(theme.axis)} axisLine={{ stroke: theme.grid }} tickLine={false} />
                        <YAxis tickFormatter={fmtCompact} tick={axisTick(theme.axis)} axisLine={false} tickLine={false} width={44} allowDecimals={false} />
                        <Tooltip
                          cursor={{ fill: theme.grid, opacity: 0.5 }}
                          content={({ active, payload, label }) => (
                            <ChartTooltip
                              active={active}
                              label={label ? `Tháng ${fmtMonth(String(label)).slice(1)}` : undefined}
                              rows={(payload ?? []).map((p) => ({ color: theme.series[0], name: METRICS[metric].unit, value: fmtNumber(Number(p.value)) }))}
                            />
                          )}
                        />
                        <Bar dataKey={metric} fill={theme.series[0]} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>

                {/* Funnel */}
                <ChartCard className="xl:col-span-3" title="Phễu theo khâu" subtitle="Số lô đã đi tới mỗi khâu">
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart layout="vertical" data={data.funnel.map((f) => ({ ...f, label: STAGE_LABELS[f.stage] }))} margin={{ top: 0, right: 36, bottom: 0, left: 0 }}>
                        <XAxis type="number" hide allowDecimals={false} />
                        <YAxis type="category" dataKey="label" tick={axisTick(theme.textSecondary)} axisLine={false} tickLine={false} width={96} />
                        <Tooltip
                          cursor={{ fill: theme.grid, opacity: 0.5 }}
                          content={({ active, payload }) => (
                            <ChartTooltip
                              active={active}
                              label={payload?.[0]?.payload?.label}
                              rows={(payload ?? []).map((p) => ({ color: theme.ordinal[0], name: 'lô', value: fmtNumber(Number(p.value)) }))}
                            />
                          )}
                        />
                        <Bar dataKey="batches" radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false}>
                          {data.funnel.map((f, i) => (
                            <Cell key={f.stage} fill={theme.ordinal[i]} />
                          ))}
                          <LabelList dataKey="batches" position="right" fill={theme.textSecondary} fontSize={11} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>

                {/* Ratios */}
                <div className="xl:col-span-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3 content-start">
                  <RingMeter label="Tỉ lệ hoàn tất chuỗi" percent={k.completionRate.value} caption="Lô đã tới khâu bán lẻ" />
                  <RingMeter label="Sự kiện đã neo blockchain" percent={k.anchoredRate.value} caption="Kiểm chứng được độc lập" />
                </div>

                {/* Stage durations */}
                <ChartCard className="xl:col-span-4" title="Thời gian giữa các khâu" subtitle="Trung bình từ khâu trước tới khâu sau">
                  {data.stageDurations.length === 0 ? (
                    <p className="text-sm text-slate-400 py-10 text-center">Chưa đủ dữ liệu</p>
                  ) : (
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          layout="vertical"
                          data={data.stageDurations.map((d) => ({ ...d, label: `${STAGE_LABELS[d.from]} → ${STAGE_LABELS[d.to]}` }))}
                          margin={{ top: 0, right: 64, bottom: 0, left: 0 }}
                        >
                          <XAxis type="number" hide />
                          <YAxis type="category" dataKey="label" tick={axisTick(theme.textSecondary)} axisLine={false} tickLine={false} width={150} />
                          <Tooltip
                            cursor={{ fill: theme.grid, opacity: 0.5 }}
                            content={({ active, payload }) => (
                              <ChartTooltip
                                active={active}
                                label={payload?.[0]?.payload?.label}
                                rows={(payload ?? []).map((p) => ({
                                  color: theme.series[0],
                                  name: `trung bình · ${p.payload.samples} lần`,
                                  value: fmtDuration(Number(p.value)),
                                }))}
                              />
                            )}
                          />
                          <Bar dataKey="avgHours" fill={theme.series[0]} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
                            <LabelList dataKey="avgHours" content={valueLabel((v) => fmtDuration(v), theme.textSecondary)} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </ChartCard>

                {/* Product types */}
                <ChartCard className="xl:col-span-4" title="Theo loại hàng" subtitle="Số lô mới trong kỳ">
                  {data.byProductType.length === 0 ? (
                    <p className="text-sm text-slate-400 py-10 text-center">Không có dữ liệu</p>
                  ) : (
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart layout="vertical" data={data.byProductType} margin={{ top: 0, right: 36, bottom: 0, left: 0 }}>
                          <XAxis type="number" hide allowDecimals={false} />
                          <YAxis type="category" dataKey="productType" tick={axisTick(theme.textSecondary)} axisLine={false} tickLine={false} width={120} />
                          <Tooltip
                            cursor={{ fill: theme.grid, opacity: 0.5 }}
                            content={({ active, payload }) => (
                              <ChartTooltip
                                active={active}
                                label={payload?.[0]?.payload?.productType}
                                rows={(payload ?? []).flatMap((p) => [
                                  { color: theme.series[0], name: 'lô', value: fmtNumber(Number(p.value)) },
                                  { color: theme.muted, name: 'kg', value: fmtNumber(Number(p.payload.volumeKg)) },
                                ])}
                              />
                            )}
                          />
                          <Bar dataKey="batches" fill={theme.series[0]} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
                            <LabelList dataKey="batches" position="right" fill={theme.textSecondary} fontSize={11} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </ChartCard>

                {/* Anomalies by type — status colors, with icon + label */}
                <ChartCard
                  className="xl:col-span-4"
                  title="Cảnh báo theo loại"
                  action={
                    <div className="flex gap-3 text-xs text-slate-600 dark:text-slate-300">
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: theme.status.warning }} />
                        <CircleAlert className="w-3.5 h-3.5" /> Chưa xử lý
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: theme.status.good }} />
                        <CircleCheck className="w-3.5 h-3.5" /> Đã xử lý
                      </span>
                    </div>
                  }
                >
                  {data.anomaliesByType.length === 0 ? (
                    <p className="text-sm text-slate-400 py-10 text-center">Không có cảnh báo trong kỳ</p>
                  ) : (
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          layout="vertical"
                          data={data.anomaliesByType.map((a) => ({ ...a, total: a.open + a.resolved, label: ANOMALY_TYPE_LABELS[a.type] }))}
                          margin={{ top: 0, right: 36, bottom: 0, left: 0 }}
                        >
                          <XAxis type="number" hide allowDecimals={false} domain={[0, 'dataMax']} />
                          <YAxis type="category" dataKey="label" tick={axisTick(theme.textSecondary)} axisLine={false} tickLine={false} width={130} />
                          <Tooltip
                            cursor={{ fill: theme.grid, opacity: 0.5 }}
                            content={({ active, payload }) => (
                              <ChartTooltip
                                active={active}
                                label={payload?.[0]?.payload?.label}
                                rows={(payload ?? []).map((p) => ({
                                  color: String(p.color),
                                  name: p.dataKey === 'open' ? 'chưa xử lý' : 'đã xử lý',
                                  value: fmtNumber(Number(p.value)),
                                }))}
                              />
                            )}
                          />
                          {/* 2px surface gap between stacked segments */}
                          <Bar dataKey="open" stackId="a" fill={theme.status.warning} stroke={theme.surface} strokeWidth={2} maxBarSize={18} isAnimationActive={false} />
                          <Bar dataKey="resolved" stackId="a" fill={theme.status.good} stroke={theme.surface} strokeWidth={2} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
                            <LabelList dataKey="total" content={valueLabel(fmtNumber, theme.textSecondary)} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </ChartCard>

                {/* Monthly performance table */}
                <ChartCard className="xl:col-span-7" title="Hiệu suất theo tháng">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                          <th className="py-2 pr-3 font-medium">Tháng</th>
                          <th className="py-2 pr-3 font-medium">Lô mới</th>
                          <th className="py-2 pr-3 font-medium text-right">Sự kiện</th>
                          <th className="py-2 pr-3 font-medium">Khối lượng (kg)</th>
                          <th className="py-2 pr-3 font-medium text-right">Thu hồi</th>
                          <th className="py-2 font-medium text-right">Cảnh báo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 tabular-nums">
                        {[...data.monthly].reverse().map((m) => (
                          <tr key={m.month}>
                            <td className="py-1.5 pr-3 whitespace-nowrap">Tháng {Number(m.month.slice(5))}/{m.month.slice(0, 4)}</td>
                            <td className="py-1.5 pr-3"><DataBarCell value={m.batches} max={monthlyMax.batches} label={fmtNumber(m.batches)} /></td>
                            <td className="py-1.5 pr-3 text-right">{fmtNumber(m.events)}</td>
                            <td className="py-1.5 pr-3"><DataBarCell value={m.volumeKg} max={monthlyMax.volumeKg} label={fmtCompact(m.volumeKg)} /></td>
                            <td className="py-1.5 pr-3 text-right">{m.recalls || '—'}</td>
                            <td className="py-1.5 text-right">{m.anomalies || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-200 dark:border-slate-700 font-semibold tabular-nums">
                          <td className="py-2 pr-3">Tổng</td>
                          <td className="py-2 pr-3 text-right">{fmtNumber(totals.batches)}</td>
                          <td className="py-2 pr-3 text-right">{fmtNumber(totals.events)}</td>
                          <td className="py-2 pr-3 text-right">{fmtCompact(totals.volumeKg)}</td>
                          <td className="py-2 pr-3 text-right">{totals.recalls}</td>
                          <td className="py-2 text-right">{totals.anomalies}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </ChartCard>

                {/* Regions */}
                <ChartCard className="xl:col-span-5" title="Theo vùng / xuất xứ" subtitle="10 vùng nhiều lô nhất">
                  {data.byOrigin.length === 0 ? (
                    <p className="text-sm text-slate-400 py-10 text-center">Không có dữ liệu</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                            <th className="py-2 pr-3 font-medium">Vùng</th>
                            <th className="py-2 pr-3 font-medium">Lô</th>
                            <th className="py-2 pr-3 font-medium text-right">Cảnh báo</th>
                            <th className="py-2 font-medium text-right">Thu hồi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 tabular-nums">
                          {data.byOrigin.map((o) => (
                            <tr key={o.origin}>
                              <td className="py-1.5 pr-3 max-w-[12rem] truncate" title={o.origin}>{o.origin}</td>
                              <td className="py-1.5 pr-3"><DataBarCell value={o.batches} max={originMax} label={fmtNumber(o.batches)} /></td>
                              <td className="py-1.5 pr-3 text-right">{o.anomalies || '—'}</td>
                              <td className="py-1.5 text-right">{o.recalls || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </ChartCard>

                {/* Organizations */}
                <ChartCard className="xl:col-span-12" title="Hiệu suất theo đơn vị" subtitle="Thời gian chờ = từ khâu trước tới khi đơn vị ghi nhận khâu của mình">
                  {data.organizations.length === 0 ? (
                    <p className="text-sm text-slate-400 py-6 text-center">Không có dữ liệu</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                            <th className="py-2 pr-3 font-medium">Đơn vị</th>
                            <th className="py-2 pr-3 font-medium">Sự kiện ghi nhận</th>
                            <th className="py-2 pr-3 font-medium text-right">Số lô xử lý</th>
                            <th className="py-2 pr-3 font-medium text-right">Thời gian chờ TB</th>
                            <th className="py-2 font-medium text-right">Cảnh báo phát sinh</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 tabular-nums">
                          {data.organizations.map((o) => (
                            <tr key={o.organization}>
                              <td className="py-1.5 pr-3 font-medium text-slate-800 dark:text-slate-100">{o.organization}</td>
                              <td className="py-1.5 pr-3"><DataBarCell value={o.events} max={orgMax} label={fmtNumber(o.events)} /></td>
                              <td className="py-1.5 pr-3 text-right">{fmtNumber(o.batches)}</td>
                              <td className="py-1.5 pr-3 text-right">{o.avgWaitHours === null ? '—' : fmtDuration(o.avgWaitHours)}</td>
                              <td className="py-1.5 text-right">{o.anomalies || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </ChartCard>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
