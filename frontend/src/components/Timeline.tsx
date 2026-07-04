import { TraceEvent, STAGE_LABELS, STAGE_ICONS } from '../api/client'

interface Props {
  events: TraceEvent[]
}

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-500',
  HIGH: 'bg-orange-500',
  MEDIUM: 'bg-yellow-400',
  LOW: 'bg-blue-400',
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
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
        Chưa có sự kiện nào được ghi nhận
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-5">
        Hành trình lô hàng <span className="text-gray-400 font-normal">({events.length} khâu)</span>
      </h3>

      <div className="relative">
        {/* Vertical connector line */}
        <div className="absolute left-[15px] top-4 bottom-4 w-px bg-gray-100" />

        <div className="space-y-5">
          {events.map((event) => (
            <div key={event.id} className="relative pl-10">
              {/* Stage icon */}
              <div className="absolute left-0 w-8 h-8 rounded-full bg-blue-50 border-2 border-blue-200
                              flex items-center justify-center text-base select-none">
                {STAGE_ICONS[event.stage] ?? '📌'}
              </div>

              <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                {/* Stage + time */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <p className="font-semibold text-sm text-gray-900">{STAGE_LABELS[event.stage]}</p>
                    <p className="text-xs text-gray-500 mt-0.5">📍 {event.location}</p>
                    {event.notes && (
                      <p className="text-xs text-gray-400 mt-0.5 italic">"{event.notes}"</p>
                    )}
                  </div>
                  <time className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
                    {formatTs(event.timestamp)}
                  </time>
                </div>

                {/* Hash chain display */}
                <div className="pt-2 border-t border-gray-200 flex items-center gap-1 flex-wrap">
                  <span className="text-xs text-gray-400">seq {event.sequenceNumber}</span>
                  <span className="text-xs text-gray-300 mx-1">·</span>
                  <span className="text-xs text-gray-400">
                    <span className="text-gray-300">prev:</span>{' '}
                    <code className="font-mono">{event.prevHash.slice(0, 10)}…</code>
                  </span>
                  <span className="text-xs text-gray-300 mx-1">→</span>
                  <code className="text-xs font-mono text-blue-500">{event.hash.slice(0, 12)}…</code>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export { SEVERITY_COLORS }
