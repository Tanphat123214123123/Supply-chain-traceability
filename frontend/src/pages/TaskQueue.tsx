import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock3, PartyPopper, Plus } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { actorsApi, Actor, batchApi, Batch, STAGE_ICONS, STAGE_LABELS } from '../api/client'
import { daysSince, nextStageOf, relativeDays } from '../domain/stageFields'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/ui/EmptyState'
import { buttonClass } from '../components/ui/Button'
import { cardClass } from '../components/ui/Card'
import { SkeletonCardList } from '../components/ui/Skeleton'

/**
 * The work inbox: every batch currently waiting on THIS person, oldest wait
 * first, each one click away from the form for exactly the stage it needs.
 */
export default function TaskQueue() {
  const { actor } = useAuth()
  const [batches, setBatches] = useState<Batch[] | null>(null)
  const [actors, setActors] = useState<Actor[]>([])

  useEffect(() => {
    batchApi.pending().then(setBatches).catch(() => setBatches([]))
    actorsApi.list().then(setActors).catch(() => {})
  }, [])

  const sorted = useMemo(
    () =>
      [...(batches ?? [])].sort(
        (a, b) => new Date(a.lastEventAt ?? a.createdAt).getTime() - new Date(b.lastEventAt ?? b.createdAt).getTime(),
      ),
    [batches],
  )
  const actorsById = useMemo(() => new Map(actors.map((a) => [a.id, a])), [actors])
  const canCreate = actor?.role === 'FARMER' || actor?.role === 'ADMIN'

  return (
    <div className="page-shell">
      <main className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
        <PageHeader
          title="Việc cần làm"
          subtitle={actor?.role === 'ADMIN' ? 'Mọi lô hàng đang chờ khâu tiếp theo trong không gian làm việc.' : 'Các lô hàng đã được bàn giao cho bạn.'}
          action={
            canCreate && (
              <Link to="/batches/new" className={buttonClass('primary', 'md')}>
                <Plus className="w-4 h-4" /> Lô hàng mới
              </Link>
            )
          }
        />

        {batches === null && <SkeletonCardList rows={3} />}
        {batches?.length === 0 && (
          <div className={cardClass()}>
            <EmptyState
              icon={<PartyPopper className="w-6 h-6" />}
              title="Không có lô hàng nào đang chờ bạn"
              description={canCreate ? 'Bắt đầu một lô mới khi bạn thu hoạch.' : 'Lô hàng sẽ xuất hiện ở đây khi khâu trước bàn giao cho bạn.'}
            />
          </div>
        )}

        <ul className="space-y-2">
          {sorted.map((b, i) => {
            const next = nextStageOf(b)
            if (!next) return null
            const Icon = STAGE_ICONS[next]
            const since = b.lastEventAt ?? b.createdAt
            const overdue = (daysSince(since) ?? 0) >= 3
            const creator = actorsById.get(b.createdBy)
            return (
              <li key={b.id} className="animate-slide-up" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                <Link to={`/record?batchId=${b.id}`} className={cardClass({ hover: true, padding: 'md', className: 'flex items-center gap-3' })}>
                  <span className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 dark:text-slate-50 truncate">{b.productName}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
                      {b.quantity.toLocaleString('vi-VN')} {b.unit} · {b.origin}
                      {creator && ` · ${creator.organization}`}
                    </p>
                    <p className={`text-xs mt-0.5 flex items-center gap-1 ${overdue ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-slate-400 dark:text-slate-500'}`}>
                      <Clock3 className="w-3 h-3" /> Chờ từ {relativeDays(since)}
                    </p>
                  </div>
                  <span className={buttonClass('secondary', 'sm', 'flex-shrink-0')}>{STAGE_LABELS[next]}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </main>
    </div>
  )
}
