import { ReactNode } from 'react'

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'orange' | 'brand'

const tones: Record<BadgeTone, string> = {
  success: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20',
  warning: 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/15 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20',
  danger: 'bg-rose-50 text-rose-700 ring-1 ring-rose-600/15 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-500/20',
  orange: 'bg-orange-50 text-orange-700 ring-1 ring-orange-600/15 dark:bg-orange-500/10 dark:text-orange-400 dark:ring-orange-500/20',
  info: 'bg-sky-50 text-sky-700 ring-1 ring-sky-600/15 dark:bg-sky-500/10 dark:text-sky-400 dark:ring-sky-500/20',
  neutral: 'bg-slate-100 text-slate-600 ring-1 ring-slate-600/10 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-500/20',
  brand: 'bg-brand-50 text-brand-700 ring-1 ring-brand-600/15 dark:bg-brand-500/10 dark:text-brand-400 dark:ring-brand-500/20',
}

interface BadgeProps {
  tone?: BadgeTone
  children: ReactNode
  className?: string
}

export default function Badge({ tone = 'neutral', children, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  )
}
