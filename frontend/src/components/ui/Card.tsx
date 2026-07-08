import { HTMLAttributes, ReactNode } from 'react'

export function cardClass(opts: { hover?: boolean; padding?: 'none' | 'sm' | 'md' | 'lg'; className?: string } = {}): string {
  const { hover = false, padding = 'md', className = '' } = opts
  const paddings = { none: '', sm: 'p-3', md: 'p-4 sm:p-5', lg: 'p-6 sm:p-8' }
  return [
    // Explicit `block` matters when this is applied to an <a> (e.g. a card
    // that's also a Link): without it, an inline-level anchor wrapping
    // block-level children forms an anonymous block box that, combined with
    // the hover transform below, triggers a real Chromium paint bug where
    // text renders clipped/ghosted. Harmless no-op on a <div>, which is
    // already block by default.
    'block bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-card dark:shadow-none',
    hover
      ? 'transition-all duration-200 hover:shadow-card-hover hover:border-brand-200/80 hover:-translate-y-0.5 dark:hover:border-brand-500/40'
      : '',
    paddings[padding],
    className,
  ]
    .filter(Boolean)
    .join(' ')
}

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
  children: ReactNode
}

export default function Card({ hover, padding, className = '', children, ...rest }: CardProps) {
  return (
    <div className={cardClass({ hover, padding, className })} {...rest}>
      {children}
    </div>
  )
}
