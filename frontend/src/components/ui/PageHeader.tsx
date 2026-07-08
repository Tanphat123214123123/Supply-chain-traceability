import { ReactNode } from 'react'

interface PageHeaderProps {
  eyebrow?: string
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
}

export default function PageHeader({ eyebrow, title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
      <div className="animate-slide-up">
        {eyebrow && (
          <p className="text-xs font-semibold text-brand-600 tracking-wide uppercase mb-1">{eyebrow}</p>
        )}
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">{subtitle}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}
