import { Clock, MapPin, UserRound } from 'lucide-react'
import { Actor, TraceEvent, STAGE_LABELS, STAGE_ICONS } from '../api/client'
import { describeEventData } from '../domain/stageFields'
import { cardClass } from './ui/Card'
import EmptyState from './ui/EmptyState'

interface Props {
  events: TraceEvent[]
  /** Directory used to show who recorded each step; unknown ids fall back to "Không rõ". */
  actorsById?: Map<string, Actor>
}

export function formatTs(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * The batch's story for the people working on it: what happened, who did it,
 * where, and the facts they recorded. The hash linkage is still one click
 * away ("Chi tiết kỹ thuật") — it just isn't the headline.
 */
export default function Timeline({ events, actorsById }: Props) {
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

      <ol className="relative">
        <div className="absolute left-[15px] top-4 bottom-4 w-px bg-gradient-to-b from-brand-200 dark:from-brand-500/30 via-slate-200 dark:via-slate-700 to-transparent" />

        <div className="space-y-5">
          {events.map((event) => {
            const StageIcon = STAGE_ICONS[event.stage]
            const who = actorsById?.get(event.actorId)
            const facts = describeEventData(event.stage, event.data ?? {})
            return (
              <li key={event.id} className="relative pl-10 animate-fade-in list-none">
                <div className="absolute left-0 w-8 h-8 rounded-full bg-gradient-to-br from-brand-50 to-brand-100 dark:from-brand-500/10 dark:to-brand-500/20 border-2 border-brand-200 dark:border-brand-500/30 flex items-center justify-center text-brand-600 dark:text-brand-400 select-none shadow-sm">
                  <StageIcon className="w-4 h-4" />
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3.5 border border-slate-100 dark:border-slate-700">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-sm text-slate-900 dark:text-slate-50">{STAGE_LABELS[event.stage]}</p>
                    <time dateTime={event.timestamp} className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap flex-shrink-0">
                      {formatTs(event.timestamp)}
                    </time>
                  </div>

                  <div className="mt-1.5 space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
                    <p className="flex items-center gap-1.5">
                      <UserRound className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      {who ? (
                        <span>
                          <span className="font-medium">{who.organization}</span>
                          <span className="text-slate-400 dark:text-slate-500"> · {who.name}</span>
                        </span>
                      ) : (
                        <span className="text-slate-400">Không rõ người thực hiện</span>
                      )}
                    </p>
                    <p className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" /> {event.location}
                    </p>
                  </div>

                  {facts.length > 0 && (
                    <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                      {facts.map((f) => (
                        <div key={f.key} className="min-w-0">
                          <dt className="text-slate-400 dark:text-slate-500">{f.label}</dt>
                          <dd className="text-slate-800 dark:text-slate-100 font-medium truncate" title={f.value}>
                            {f.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  {event.notes && <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 italic">"{event.notes}"</p>}

                  <details className="mt-2.5 group">
                    <summary className="text-[11px] text-slate-400 dark:text-slate-500 cursor-pointer select-none hover:text-slate-600 dark:hover:text-slate-300 list-none">
                      <span className="group-open:hidden">▸</span>
                      <span className="hidden group-open:inline">▾</span> Chi tiết kỹ thuật
                    </summary>
                    <div className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500 font-mono break-all space-y-0.5">
                      <p>seq {event.sequenceNumber} · v{event.hashVersion}</p>
                      <p>prev: {event.prevHash}</p>
                      <p className="text-brand-500 dark:text-brand-400">hash: {event.hash}</p>
                    </div>
                  </details>
                </div>
              </li>
            )
          })}
        </div>
      </ol>
    </div>
  )
}
