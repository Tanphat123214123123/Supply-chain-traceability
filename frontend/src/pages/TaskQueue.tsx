import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PartyPopper } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { batchApi, Batch, ROLE_LABELS, ROLE_STAGES, STAGE_LABELS } from '../api/client'
import PageHeader from '../components/ui/PageHeader'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import { cardClass } from '../components/ui/Card'
import { SkeletonCardList } from '../components/ui/Skeleton'

export default function TaskQueue() {
  const { actor } = useAuth()
  const [batches, setBatches] = useState<Batch[] | null>(null)

  useEffect(() => {
    batchApi.pending().then(setBatches).catch(() => setBatches([]))
  }, [])

  const allowedStages = actor ? ROLE_STAGES[actor.role] : []

  return (
    <div className="page-shell">
      <main className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
        <PageHeader
          title="Việc cần làm"
          subtitle={
            <>
              Lô hàng đang chờ khâu tiếp theo phù hợp với vai trò <strong>{actor ? ROLE_LABELS[actor.role] : ''}</strong>
              {' '}({allowedStages.map((s) => STAGE_LABELS[s]).join(', ')}).
            </>
          }
        />

        {batches === null && <SkeletonCardList rows={3} />}
        {batches?.length === 0 && (
          <EmptyState icon={<PartyPopper className="w-6 h-6" />} title="Không có lô hàng nào đang chờ khâu của bạn" description="Quay lại sau khi có lô hàng mới được bàn giao." />
        )}

        <div className="space-y-2">
          {batches?.map((b, i) => (
            <Link
              key={b.id}
              to={`/record?batchId=${b.id}`}
              className={cardClass({ hover: true, className: 'animate-slide-up' })}
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            >
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-50 truncate">{b.productName}</span>
                  <Badge tone="warning">
                    {b.currentStage ? STAGE_LABELS[b.currentStage] : 'Chưa bắt đầu'} → tiếp theo
                  </Badge>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {b.productType} · {b.origin} · {b.quantity} {b.unit}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
