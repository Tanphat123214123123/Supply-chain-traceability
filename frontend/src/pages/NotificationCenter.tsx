import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { notificationsApi, NotificationItem } from '../api/client'
import PageHeader from '../components/ui/PageHeader'
import Badge, { BadgeTone } from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import { cardClass } from '../components/ui/Card'
import { SkeletonCardList } from '../components/ui/Skeleton'

const SEVERITY_TONE: Record<string, BadgeTone> = {
  CRITICAL: 'danger',
  HIGH: 'orange',
  MEDIUM: 'warning',
  LOW: 'info',
}

export default function NotificationCenter() {
  const [items, setItems] = useState<NotificationItem[] | null>(null)

  useEffect(() => {
    notificationsApi.list(50).then(setItems).catch(() => setItems([]))
  }, [])

  return (
    <div className="page-shell">
      <main className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
        <PageHeader
          title="Trung tâm thông báo"
          subtitle="Lịch sử cảnh báo bất thường và thu hồi lô hàng — kể cả những cái bạn có thể đã bỏ lỡ."
        />

        {items === null && <SkeletonCardList rows={4} />}
        {items?.length === 0 && <EmptyState icon={<Bell className="w-6 h-6" />} title="Chưa có thông báo nào" />}

        <div className="space-y-2">
          {items?.map((n, i) => (
            <Link
              key={n.id}
              to={`/batch/${n.batchId}`}
              className={cardClass({ hover: true, className: 'animate-slide-up' })}
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <Badge tone={n.kind === 'RECALL' ? 'danger' : SEVERITY_TONE[n.severity ?? 'LOW']}>
                    {n.kind === 'RECALL' ? 'Thu hồi' : n.severity}
                  </Badge>
                  <span className="text-xs text-slate-400 dark:text-slate-500">{new Date(n.createdAt).toLocaleString('vi-VN')}</span>
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-300">{n.message}</p>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
