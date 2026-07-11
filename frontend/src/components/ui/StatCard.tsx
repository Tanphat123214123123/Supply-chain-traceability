import { ReactNode } from 'react'
import { cardClass } from './Card'

export type StatTone = 'brand' | 'success' | 'danger' | 'warning' | 'neutral'

const valueTones: Record<StatTone, string> = {
  brand: 'text-brand-600 dark:text-brand-400',
  success: 'text-emerald-600 dark:text-emerald-400',
  danger: 'text-rose-500 dark:text-rose-400',
  warning: 'text-amber-600 dark:text-amber-400',
  neutral: 'text-slate-900 dark:text-slate-50',
}

const iconTones: Record<StatTone, string> = {
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400',
  success: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
  danger: 'bg-rose-50 text-rose-500 dark:bg-rose-500/10 dark:text-rose-400',
  warning: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
  neutral: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
}

interface StatCardProps {
  label: string
  value: ReactNode
  tone?: StatTone
  icon?: ReactNode
}

export default function StatCard({ label, value, tone = 'neutral', icon }: StatCardProps) {
  return (
    <div className={cardClass({ padding: 'sm', className: 'flex items-center gap-3' })}>
      {icon && (
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0 ${iconTones[tone]}`}>
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <p className={`text-xl font-bold leading-tight ${valueTones[tone]}`}>{value}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">{label}</p>
      </div>
    </div>
  )
}
