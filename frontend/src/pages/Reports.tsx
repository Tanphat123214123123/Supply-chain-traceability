import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Package, Activity, Siren, FileText, AlertTriangle, ShieldCheck, ShieldAlert } from 'lucide-react'
import { batchApi, statsApi, StatsByDay, StatsByOrigin, StatsByStage, StatsOverview, STAGE_LABELS } from '../api/client'
import PageHeader from '../components/ui/PageHeader'
import StatCard from '../components/ui/StatCard'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { inputClass } from '../components/ui/field'
import { cardClass } from '../components/ui/Card'

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function Reports() {
  const [overview, setOverview] = useState<StatsOverview | null>(null)
  const [byStage, setByStage] = useState<StatsByStage[]>([])
  const [byDay, setByDay] = useState<StatsByDay[]>([])
  const [byOrigin, setByOrigin] = useState<StatsByOrigin[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [origin, setOrigin] = useState('')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    statsApi.overview().then(setOverview).catch(() => {})
    statsApi.byStage().then(setByStage).catch(() => {})
    statsApi.byDay().then(setByDay).catch(() => {})
    statsApi.byOrigin().then(setByOrigin).catch(() => {})
  }, [])

  const handleExport = async () => {
    setExporting(true)
    try {
      const csv = await batchApi.exportCsv({ from: from || undefined, to: to || undefined, origin: origin || undefined })
      downloadCsv('bao-cao-lo-hang.csv', csv)
    } catch {
      window.alert('Xuất báo cáo thất bại')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="page-shell">
      <main className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
        <PageHeader title="Báo cáo & Thống kê" subtitle="Toàn cảnh số liệu vận hành chuỗi cung ứng." />

        {overview && (
          <>
            {(() => {
              const isHealthy = overview.recalledBatches === 0 && overview.anomalyCount === 0
              return (
                <div
                  className={cardClass({
                    padding: 'lg',
                    className: `flex items-center justify-between gap-4 flex-wrap ${
                      isHealthy
                        ? 'ring-1 ring-emerald-500/20 dark:ring-emerald-500/20'
                        : 'ring-1 ring-amber-500/20 dark:ring-amber-500/20'
                    }`,
                  })}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                        isHealthy
                          ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                          : 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400'
                      }`}
                    >
                      {isHealthy ? <ShieldCheck className="w-7 h-7" /> : <ShieldAlert className="w-7 h-7" />}
                    </div>
                    <div>
                      <p className="text-lg font-bold text-slate-900 dark:text-slate-50">
                        {isHealthy ? 'Chuỗi cung ứng đang ổn định' : 'Chuỗi cung ứng cần chú ý'}
                      </p>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                        {overview.activeBatches} lô hàng đang lưu thông · {overview.totalEvents} sự kiện đã ghi nhận
                      </p>
                    </div>
                  </div>
                  {!isHealthy && (
                    <div className="flex items-center gap-2 flex-wrap">
                      {overview.recalledBatches > 0 && <Badge tone="danger">{overview.recalledBatches} đã thu hồi</Badge>}
                      {overview.anomalyCount > 0 && <Badge tone="warning">{overview.anomalyCount} bất thường</Badge>}
                    </div>
                  )}
                </div>
              )
            })()}

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <StatCard label="Tổng lô hàng" value={overview.totalBatches} tone="neutral" icon={<Package className="w-5 h-5" />} />
              <StatCard label="Đang hoạt động" value={overview.activeBatches} tone="success" icon={<Activity className="w-5 h-5" />} />
              <StatCard label="Đã thu hồi" value={overview.recalledBatches} tone="danger" icon={<Siren className="w-5 h-5" />} />
              <StatCard label="Tổng sự kiện" value={overview.totalEvents} tone="brand" icon={<FileText className="w-5 h-5" />} />
              <StatCard label="Bất thường" value={overview.anomalyCount} tone="warning" icon={<AlertTriangle className="w-5 h-5" />} />
            </div>
          </>
        )}

        <div className={cardClass()}>
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Lô hàng tạo mới theo ngày (30 ngày gần nhất)</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={byDay}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
              <Line type="monotone" dataKey="count" stroke="#4750e3" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className={cardClass()}>
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Phân bổ sự kiện theo khâu</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byStage.map((d) => ({ ...d, label: STAGE_LABELS[d.stage] }))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
              <Bar dataKey="count" fill="#4750e3" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className={cardClass()}>
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Theo xuất xứ</h2>
          <div className="space-y-1.5">
            {byOrigin.map((o) => (
              <div key={o.origin} className="flex items-center justify-between text-sm">
                <span className="text-slate-700 dark:text-slate-300">{o.origin}</span>
                <span className="text-slate-400 dark:text-slate-500">
                  {o.batchCount} lô{o.anomalyCount > 0 && <span className="text-amber-600 dark:text-amber-400 ml-2">· {o.anomalyCount} bất thường</span>}
                </span>
              </div>
            ))}
            {byOrigin.length === 0 && <p className="text-sm text-slate-400 dark:text-slate-500">Chưa có dữ liệu.</p>}
          </div>
        </div>

        <div className={cardClass()}>
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Xuất báo cáo hàng loạt</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Từ ngày</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Đến ngày</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Xuất xứ</label>
              <input type="text" value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="VD: Đà Lạt" className={inputClass} />
            </div>
          </div>
          <Button type="button" disabled={exporting} onClick={handleExport} size="sm">
            {exporting ? 'Đang xuất...' : 'Xuất CSV'}
          </Button>
        </div>
      </main>
    </div>
  )
}
