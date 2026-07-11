import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Package } from 'lucide-react'
import { actorsApi, ActorDetail as ActorDetailData, ROLE_LABELS, STAGE_LABELS } from '../api/client'
import EmptyState from '../components/ui/EmptyState'
import { cardClass } from '../components/ui/Card'
import { Skeleton, SkeletonCardList } from '../components/ui/Skeleton'

export default function ActorDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<ActorDetailData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    actorsApi.detail(id).then(setData).catch(() => setError('Không tìm thấy đối tác'))
  }, [id])

  if (error) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="text-center">
          <p className="text-rose-500 dark:text-rose-400 text-sm mb-3">{error}</p>
          <button onClick={() => navigate('/actors')} className="text-brand-600 dark:text-brand-400 text-sm hover:underline">← Về danh bạ</button>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="page-shell">
        <main className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
          <Skeleton className="h-24 w-full" />
          <SkeletonCardList rows={3} />
        </main>
      </div>
    )
  }

  const { actor, batches } = data

  return (
    <div className="page-shell">
      <main className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
        <button onClick={() => navigate(-1)} className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 text-sm">← Quay lại</button>

        <div className={cardClass({ padding: 'lg' })}>
          <div className="flex items-center gap-4">
            <span className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500 to-emerald-500 text-white flex items-center justify-center text-xl font-bold flex-shrink-0">
              {actor.name.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50 truncate">{actor.name}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{actor.organization} · {ROLE_LABELS[actor.role]}</p>
              {actor.email && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{actor.email}</p>}
            </div>
          </div>
          <p className="text-xs text-slate-300 dark:text-slate-600 mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
            Tham gia từ {new Date(actor.createdAt).toLocaleDateString('vi-VN')}
            {!actor.isActive && <span className="ml-2 text-rose-500 dark:text-rose-400">· Tài khoản đã bị khoá</span>}
          </p>
        </div>

        <div className={cardClass()}>
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
            Lô hàng đã tham gia ({batches.length})
          </h2>
          {batches.length === 0 && <EmptyState icon={<Package className="w-6 h-6" />} title="Chưa tham gia lô hàng nào" />}
          <div className="space-y-2">
            {batches.map((b) => (
              <Link
                key={b.id}
                to={`/batch/${b.id}`}
                className="block border border-slate-100 dark:border-slate-800 rounded-xl p-3 hover:border-brand-200 dark:hover:border-brand-500/40 hover:bg-brand-50/30 dark:hover:bg-brand-500/10 transition-colors"
              >
                <p className="text-sm font-medium text-slate-900 dark:text-slate-50">{b.productName}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {b.origin} · {b.currentStage ? STAGE_LABELS[b.currentStage] : 'Chưa bắt đầu'}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
