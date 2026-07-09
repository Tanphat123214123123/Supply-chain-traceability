import { Clock, MapPin } from 'lucide-react'
import { TraceEvent, STAGE_LABELS, STAGE_ICONS } from '../api/client'
import { cardClass } from './ui/Card'
import EmptyState from './ui/EmptyState'

interface Props {
  events: TraceEvent[]
}

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: 'bg-rose-500',
  HIGH: 'bg-orange-500',
  MEDIUM: 'bg-amber-400',
  LOW: 'bg-brand-400',
}

function formatTs(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function Timeline({ events }: Props) {
  if (events.length === 0) {
    return (
      <div className={cardClass()}>
        <EmptyState icon={<Clock className="w-6 h-6" />} title="Chưa có sự kiện nào được ghi nhận" />
      </div>
    )
  }

  return (
    <div className={cardClass()}>
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-5">
        Hành trình lô hàng <span className="text-slate-400 dark:text-slate-500 font-normal">({events.length} khâu)</span>
      </h3>

      <div className="relative">
        {/* Vertical connector line */}
        <div className="absolute left-[15px] top-4 bottom-4 w-px bg-gradient-to-b from-brand-200 dark:from-brand-500/30 via-slate-200 dark:via-slate-700 to-transparent" />

        <div className="space-y-5">
          {events.map((event) => {
            const StageIcon = STAGE_ICONS[event.stage]
            return (
            <div key={event.id} className="relative pl-10 animate-fade-in">
              {/* Stage icon */}
              <div className="absolute left-0 w-8 h-8 rounded-full bg-gradient-to-br from-brand-50 to-brand-100 dark:from-brand-500/10 dark:to-brand-500/20 border-2 border-brand-200 dark:border-brand-500/30
                              flex items-center justify-center text-brand-600 dark:text-brand-400 select-none shadow-sm">
                <StageIcon className="w-4 h-4" />
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3.5 border border-slate-100 dark:border-slate-700">
                {/* Stage + time */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <p className="font-semibold text-sm text-slate-900 dark:text-slate-50">{STAGE_LABELS[event.stage]}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> {event.location}
                    </p>
                    {event.notes && (
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 italic">"{event.notes}"</p>
                    )}
                  </div>
                  <time className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap flex-shrink-0">
                    {formatTs(event.timestamp)}
                  </time>
                </div>

                {/* Hash chain display */}
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center gap-1 flex-wrap">
                  <span className="text-xs text-slate-400 dark:text-slate-500">seq {event.sequenceNumber}</span>
                  <span className="text-xs text-slate-300 dark:text-slate-600 mx-1">·</span>
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    <span className="text-slate-300 dark:text-slate-600">prev:</span>{' '}
                    <code className="font-mono">{event.prevHash.slice(0, 10)}…</code>
                  </span>
                  <span className="text-xs text-slate-300 dark:text-slate-600 mx-1">→</span>
                  <code className="text-xs font-mono text-brand-500 dark:text-brand-400">{event.hash.slice(0, 12)}…</code>
                </div>
              </div>
            </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export { SEVERITY_COLORS }
