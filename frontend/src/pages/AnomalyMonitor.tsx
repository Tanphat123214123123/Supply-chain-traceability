import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { adminApi, Anomaly, AnomalySeverity } from '../api/client'
import PageHeader from '../components/ui/PageHeader'
import Badge, { BadgeTone } from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import { cardClass } from '../components/ui/Card'
import { SkeletonCardList } from '../components/ui/Skeleton'

const SEVERITY_TONE: Record<AnomalySeverity, BadgeTone> = {
  CRITICAL: 'danger',
  HIGH: 'orange',
  MEDIUM: 'warning',
  LOW: 'info',
}

export default function AnomalyMonitor() {
  const [items, setItems] = useState<Anomaly[]>([])
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState<'all' | 'unresolved' | 'resolved'>('unresolved')
  const [loading, setLoading] = useState(true)
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    adminApi
      .anomalies({ page: 1, pageSize: 50, resolved: filter === 'all' ? undefined : filter === 'resolved' })
      .then((res) => {
        setItems(res.items)
        setTotal(res.total)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  const handleResolve = async (id: string) => {
    setResolvingId(id)
    try {
      await adminApi.resolveAnomaly(id)
      load()
    } catch {
      window.alert('Không thể duyệt bất thường này')
    } finally {
      setResolvingId(null)
    }
  }

  return (
    <div className="page-shell">
      <main className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
        <PageHeader
          title="Giám sát bất thường hệ thống"
          subtitle="Bỏ khâu, trùng khâu, sai thứ tự — mọi bất thường phát hiện tự động đều xuất hiện tại đây."
          action={<span className="text-sm text-slate-400 dark:text-slate-500">{total} kết quả</span>}
        />

        <div className="flex rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 w-fit shadow-card dark:shadow-none">
          {(['unresolved', 'resolved', 'all'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`text-sm px-4 py-2 transition-colors ${filter === f ? 'bg-brand-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
            >
              {f === 'unresolved' ? 'Chưa xử lý' : f === 'resolved' ? 'Đã xử lý' : 'Tất cả'}
            </button>
          ))}
        </div>

        {loading && <SkeletonCardList rows={3} />}
        {!loading && items.length === 0 && (
          <EmptyState icon={<CheckCircle2 className="w-6 h-6" />} title="Không có bất thường nào ở bộ lọc này" />
        )}

        <div className="space-y-2">
          {items.map((a) => (
            <div key={a.id} className={cardClass()}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Badge tone={SEVERITY_TONE[a.severity]}>{a.severity}</Badge>
                    <span className="text-xs text-slate-400 dark:text-slate-500">{a.type}</span>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300">{a.message}</p>
                  <Link to={`/batch/${a.batchId}`} className="text-xs text-brand-600 dark:text-brand-400 hover:underline font-medium">
                    Xem lô hàng →
                  </Link>
                  <p className="text-xs text-slate-300 dark:text-slate-600 mt-1">
                    Phát hiện lúc {new Date(a.detectedAt).toLocaleString('vi-VN')}
                    {a.resolved && a.resolvedAt && (
                      <span> · Đã xử lý lúc {new Date(a.resolvedAt).toLocaleString('vi-VN')}</span>
                    )}
                  </p>
                </div>
                {!a.resolved && (
                  <button
                    type="button"
                    disabled={resolvingId === a.id}
                    onClick={() => handleResolve(a.id)}
                    className="text-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20 disabled:opacity-60 px-3 py-1.5 rounded-lg flex-shrink-0 transition-colors font-medium"
                  >
                    {resolvingId === a.id ? 'Đang xử lý...' : 'Đánh dấu đã xử lý'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
