import { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import type { KpiValue } from '../../api/client'
import { ChartTheme, useChartTheme } from './chartTheme'

/** A white panel with a title — the unit every chart on the dashboard sits in. */
export function ChartCard({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-card dark:shadow-none p-4 sm:p-5 min-w-0 ${className}`}>
      <header className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[#2b3d6f] dark:text-slate-100">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

/** Tooltip body: value strong first, label secondary, a short line key per series. */
export function ChartTooltip({
  active,
  label,
  rows,
}: {
  active?: boolean
  label?: string
  rows: Array<{ color: string; name: string; value: string }>
}) {
  if (!active || rows.length === 0) return null
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-card-hover px-3 py-2 text-xs">
      {label && <p className="text-slate-500 dark:text-slate-400 mb-1">{label}</p>}
      {rows.map((r) => (
        <p key={r.name} className="flex items-center gap-2">
          <span className="inline-block w-3 h-0.5 rounded" style={{ background: r.color }} />
          <span className="font-semibold text-slate-900 dark:text-slate-50 tabular-nums">{r.value}</span>
          <span className="text-slate-500 dark:text-slate-400">{r.name}</span>
        </p>
      ))}
    </div>
  )
}

/** "up is good" decides whether a rise is shown as good or bad. */
function Delta({ kpi, upIsGood, theme }: { kpi: KpiValue; upIsGood: boolean; theme: ChartTheme }) {
  if (kpi.previous === null) return <span className="text-xs text-slate-400">Chưa có kỳ trước</span>
  const diff = kpi.value - kpi.previous
  if (Math.abs(diff) < 1e-9) {
    return (
      <span className="text-xs text-slate-500 inline-flex items-center gap-0.5">
        <Minus className="w-3 h-3" /> Không đổi so với kỳ trước
      </span>
    )
  }
  if (kpi.previous === 0) {
    return <span className="text-xs text-slate-500 dark:text-slate-400">Kỳ trước: 0</span>
  }
  const pct = kpi.previous !== 0 ? (diff / Math.abs(kpi.previous)) * 100 : null
  const good = diff > 0 === upIsGood
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight
  const color = good ? theme.status.good : theme.status.critical
  return (
    <span className="text-xs text-slate-600 dark:text-slate-300 inline-flex items-center gap-0.5">
      <Icon className="w-3.5 h-3.5" style={{ color }} aria-hidden="true" />
      <span className="font-medium tabular-nums">{`${diff > 0 ? '+' : ''}${(pct ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`}</span>
      <span className="text-slate-400">so với kỳ trước</span>
      <span className="sr-only">{good ? '(tốt)' : '(xấu)'}</span>
    </span>
  )
}

/** Stat tile: label · value · delta vs the previous window · 12-point sparkline (history muted, now accented). */
export function KpiCard({
  label,
  value,
  kpi,
  upIsGood = true,
}: {
  label: string
  value: string
  kpi: KpiValue
  upIsGood?: boolean
}) {
  const theme = useChartTheme()
  const data = kpi.trend.map((v, i) => ({ i, v }))
  const hasTrend = data.length > 1 && data.some((d) => d.v !== 0)
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-card dark:shadow-none p-4 min-w-0">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <div className="flex items-end justify-between gap-2 mt-1">
        <p className="text-2xl font-semibold text-slate-900 dark:text-slate-50 leading-none">{value}</p>
        {hasTrend && (
          <div className="w-24 h-9" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 2, right: 4, bottom: 2, left: 0 }}>
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={theme.series[0]}
                  strokeWidth={2}
                  fill={theme.series[0]}
                  fillOpacity={0.1}
                  isAnimationActive={false}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      <div className="mt-2">
        <Delta kpi={kpi} upIsGood={upIsGood} theme={theme} />
      </div>
    </div>
  )
}

/** A ratio as a ring meter: the filled arc carries the value, the track is a lighter step of the same hue. */
export function RingMeter({ label, percent, caption }: { label: string; percent: number; caption: string }) {
  const theme = useChartTheme()
  const r = 26
  const c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(100, percent))
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-card dark:shadow-none p-4 flex items-center justify-between gap-3 min-w-0">
      <div className="min-w-0">
        <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
        <p className="text-2xl font-semibold text-slate-900 dark:text-slate-50 leading-none mt-1">{p.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%</p>
        <p className="text-xs text-slate-400 mt-2">{caption}</p>
      </div>
      <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`${label}: ${p.toFixed(1)}%`} className="flex-shrink-0">
        <circle cx="32" cy="32" r={r} fill="none" stroke={theme.ordinal[5]} strokeOpacity={0.35} strokeWidth="7" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={theme.series[0]}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${(p / 100) * c} ${c}`}
          transform="rotate(-90 32 32)"
        />
      </svg>
    </div>
  )
}

/** Table cell with an in-cell bar (the template's yellow data bars); the number stays in ink beside it. */
export function DataBarCell({ value, max, label }: { value: number; max: number; label: string }) {
  const theme = useChartTheme()
  const w = max > 0 ? Math.max(2, (value / max) * 100) : 0
  return (
    <div className="flex items-center gap-2 min-w-[7rem]">
      <div className="flex-1 h-3 rounded-sm bg-slate-100 dark:bg-slate-800 overflow-hidden" aria-hidden="true">
        <div className="h-full rounded-r-sm" style={{ width: `${w}%`, background: theme.series[3] }} />
      </div>
      <span className="tabular-nums text-right w-16 text-slate-700 dark:text-slate-200">{label}</span>
    </div>
  )
}
