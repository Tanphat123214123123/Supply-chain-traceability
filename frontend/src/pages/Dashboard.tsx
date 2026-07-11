import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Hand, Package, Activity, Siren } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { batchApi, statsApi, Batch, StatsOverview, STAGE_LABELS, STAGE_ORDER } from '../api/client'
import PageHeader from '../components/ui/PageHeader'
import StatCard from '../components/ui/StatCard'
import EmptyState from '../components/ui/EmptyState'
import Badge from '../components/ui/Badge'
import { buttonClass } from '../components/ui/Button'
import { cardClass } from '../components/ui/Card'
import { inputClass } from '../components/ui/field'
import { SkeletonCardList } from '../components/ui/Skeleton'

const PAGE_SIZE = 10

// recharts (~370KB) is only needed for this one ADMIN-only chart — split into
// its own chunk instead of shipping it to every visitor's initial bundle.
const StageChart = lazy(() => import('../components/StageChart'))

function StagePill({ stage }: { stage: Batch['currentStage'] }) {
  if (!stage) return <Badge tone="neutral">Chưa bắt đầu</Badge>
  return <Badge tone="brand">{STAGE_LABELS[stage]}</Badge>
}

function BatchCard({ batch }: { batch: Batch }) {
  return (
    <Link to={`/batch/${batch.id}`} className={cardClass({ hover: true, padding: 'md', className: 'flex items-center justify-between gap-3' })}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-slate-900 dark:text-slate-50 truncate">{batch.productName}</span>
          {batch.isRecalled && <Badge tone="danger">Thu hồi</Badge>}
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate">
          {batch.productType} · {batch.origin} · {batch.quantity} {batch.unit}
        </p>
        <p className="text-xs text-slate-300 dark:text-slate-600 mt-0.5 font-mono">{batch.id.slice(0, 8)}…</p>
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <StagePill stage={batch.currentStage} />
        <span className="text-xs text-slate-400 dark:text-slate-500">{new Date(batch.createdAt).toLocaleDateString('vi-VN')}</span>
      </div>
    </Link>
  )
}

function KanbanBoard() {
  const [batches, setBatches] = useState<Batch[] | null>(null)

  useEffect(() => {
    batchApi.list({ page: 1, pageSize: 200 }).then((res) => setBatches(res.items)).catch(() => setBatches([]))
  }, [])

  if (!batches) return <SkeletonCardList rows={4} className="mt-2" />

  const columns: Array<{ key: string; label: string; items: Batch[] }> = [
    { key: 'NONE', label: 'Chưa bắt đầu', items: batches.filter((b) => !b.currentStage) },
    ...STAGE_ORDER.map((stage) => ({
      key: stage,
      label: STAGE_LABELS[stage],
      items: batches.filter((b) => b.currentStage === stage),
    })),
  ]

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((col) => (
        <div key={col.key} className="bg-slate-100/70 dark:bg-slate-800/70 rounded-2xl p-3 w-64 flex-shrink-0">
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2 flex items-center justify-between">
            {col.label}
            <span className="bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 rounded-full px-2 py-0.5 shadow-sm">{col.items.length}</span>
          </h3>
          <div className="space-y-2">
            {col.items.map((b) => (
              <Link
                key={b.id}
                to={`/batch/${b.id}`}
                className="block bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3 hover:border-brand-300 dark:hover:border-brand-500/40 hover:shadow-card-hover transition-all"
              >
                <p className="text-sm font-medium text-slate-900 dark:text-slate-50 truncate">{b.productName}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{b.origin}</p>
                {b.isRecalled && (
                  <span className="mt-1 inline-block">
                    <Badge tone="danger">Thu hồi</Badge>
                  </span>
                )}
              </Link>
            ))}
            {col.items.length === 0 && <p className="text-xs text-slate-300 dark:text-slate-600 text-center py-3">— trống —</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const { actor } = useAuth()
  const navigate = useNavigate()
  const [view, setView] = useState<'list' | 'kanban'>('list')
  const [batches, setBatches] = useState<Batch[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [overview, setOverview] = useState<StatsOverview | null>(null)

  // Debounce the search box so we don't fire a request on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput)
      setPage(1)
    }, 300)
    return () => clearTimeout(handle)
  }, [searchInput])

  useEffect(() => {
    if (view !== 'list') return
    setLoading(true)
    setError('')
    batchApi.list({ page, pageSize: PAGE_SIZE, search: search || undefined })
      .then((res) => {
        setBatches(res.items)
        setTotal(res.total)
      })
      .catch(() => setError('Không thể tải danh sách lô hàng'))
      .finally(() => setLoading(false))
  }, [page, search, view])

  useEffect(() => {
    statsApi.overview().then(setOverview).catch(() => {})
  }, [batches])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="page-shell">
      <main className="max-w-5xl mx-auto p-4 sm:p-6">
        <PageHeader
          title={
            <span className="inline-flex items-center gap-2">
              Chào {actor?.name?.split(' ').pop() ?? ''}
              <Hand className="w-5 h-5 text-amber-500" />
            </span>
          }
          subtitle="Tổng quan toàn bộ lô hàng đang lưu thông trong chuỗi cung ứng của bạn."
          action={
            <button onClick={() => navigate('/record')} className={buttonClass('primary', 'md')}>
              + Ghi sự kiện
            </button>
          }
        />

        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-3 my-5">
          <StatCard icon={<Package className="w-5 h-5" />} tone="neutral" label="Tổng lô hàng" value={overview?.totalBatches ?? total} />
          <StatCard icon={<Activity className="w-5 h-5" />} tone="success" label="Đang hoạt động" value={overview?.activeBatches ?? '–'} />
          <StatCard icon={<Siren className="w-5 h-5" />} tone="danger" label="Đã thu hồi" value={overview?.recalledBatches ?? '–'} />
        </div>

        {/* Actions row */}
        <div className="flex items-center gap-3 mb-5">
          <input
            type="text"
            placeholder="Tìm theo tên sản phẩm, xuất xứ, ID..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className={`flex-1 ${inputClass}`}
          />
          <div className="flex rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex-shrink-0">
            <button
              type="button"
              onClick={() => setView('list')}
              className={`text-sm px-3.5 py-2.5 transition-colors ${view === 'list' ? 'bg-brand-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
            >
              Danh sách
            </button>
            <button
              type="button"
              onClick={() => setView('kanban')}
              className={`text-sm px-3.5 py-2.5 transition-colors ${view === 'kanban' ? 'bg-brand-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
            >
              Kanban
            </button>
          </div>
        </div>

        {actor?.role === 'ADMIN' && view === 'list' && (
          <Suspense fallback={null}>
            <StageChart />
          </Suspense>
        )}

        {view === 'kanban' ? (
          <KanbanBoard />
        ) : (
          <>
            {loading && <SkeletonCardList rows={5} />}
            {error && <p className="text-center text-rose-500 dark:text-rose-400 py-16 text-sm">{error}</p>}

            {!loading && !error && batches.length === 0 && (
              <EmptyState
                icon={<Package className="w-6 h-6" />}
                title={search ? 'Không tìm thấy lô hàng phù hợp' : 'Chưa có lô hàng nào'}
                description={search ? 'Thử một từ khoá khác.' : 'Bắt đầu bằng cách ghi sự kiện đầu tiên cho một lô hàng.'}
              />
            )}

            <div className="space-y-2">
              {batches.map((b, i) => (
                <div key={b.id} className="animate-slide-up" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                  <BatchCard batch={b} />
                </div>
              ))}
            </div>

            {!loading && !error && total > 0 && (
              <div className="flex items-center justify-center gap-3 mt-5">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300
                             disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  ← Trước
                </button>
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  Trang {page} / {totalPages} · {total} lô hàng
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300
                             disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Sau →
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
