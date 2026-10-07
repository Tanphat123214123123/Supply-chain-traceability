import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Batch, STAGE_LABELS } from '../api/client'
import { daysSince, nextStageOf, relativeDays } from '../domain/stageFields'
import Badge from './ui/Badge'
import { cardClass } from './ui/Card'

/** The batch's state in one phrase: what it's waiting for, or how it ended. */
export function BatchStatusBadge({ batch }: { batch: Batch }) {
  if (batch.isRecalled) return <Badge tone="danger">Đã thu hồi</Badge>
  const next = nextStageOf(batch)
  if (!next) return <Badge tone="success">Hoàn tất</Badge>
  const waited = daysSince(batch.lastEventAt ?? batch.createdAt) ?? 0
  return <Badge tone={waited >= 3 ? 'warning' : 'brand'}>Chờ {STAGE_LABELS[next].toLowerCase()}</Badge>
}

export default function BatchRow({ batch, to, action }: { batch: Batch; to?: string; action?: string }) {
  const lastActivity = batch.lastEventAt ?? batch.createdAt
  return (
    <Link
      to={to ?? `/batch/${batch.id}`}
      className={cardClass({ hover: true, padding: 'md', className: 'flex items-center justify-between gap-3' })}
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-900 dark:text-slate-50 truncate">{batch.productName}</p>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate">
          {batch.origin} · {batch.quantity.toLocaleString('vi-VN')} {batch.unit}
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Cập nhật {relativeDays(lastActivity)}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <BatchStatusBadge batch={batch} />
        {action ? (
          <span className="text-sm font-medium text-brand-600 dark:text-brand-400 hidden sm:inline">{action} →</span>
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600" />
        )}
      </div>
    </Link>
  )
}
