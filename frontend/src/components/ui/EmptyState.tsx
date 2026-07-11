import { ReactNode } from 'react'
import { Inbox } from 'lucide-react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-500 mb-4">
        {icon ?? <Inbox className="w-6 h-6" />}
      </div>
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</p>
      {description && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
