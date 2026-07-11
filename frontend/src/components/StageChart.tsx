import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useTheme } from '../context/ThemeContext'
import { statsApi, StatsByStage, STAGE_LABELS } from '../api/client'
import { cardClass } from './ui/Card'

export default function StageChart() {
  const [data, setData] = useState<StatsByStage[]>([])
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  useEffect(() => {
    statsApi.byStage().then(setData).catch(() => {})
  }, [])

  if (data.every((d) => d.count === 0)) return null

  const gridColor = isDark ? '#334155' : '#f1f5f9'
  const tickColor = isDark ? '#94a3b8' : '#64748b'

  return (
    <div className={cardClass({ className: 'mb-5' })}>
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Phân bổ sự kiện theo khâu</h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data.map((d) => ({ ...d, label: STAGE_LABELS[d.stage] }))}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: tickColor }} interval={0} angle={-20} textAnchor="end" height={50} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: tickColor }} />
          <Tooltip
            contentStyle={{
              borderRadius: 12,
              border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
              fontSize: 12,
              background: isDark ? '#1e293b' : '#fff',
              color: isDark ? '#e2e8f0' : '#0f172a',
            }}
          />
          <Bar dataKey="count" fill={isDark ? '#818cf8' : '#4750e3'} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
