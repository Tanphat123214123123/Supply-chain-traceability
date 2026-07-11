import { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
export type ButtonSize = 'sm' | 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-1.5 font-medium transition-all duration-150 ' +
  'disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap select-none active:scale-[0.98]'

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-soft hover:bg-brand-700 hover:shadow-card-hover active:bg-brand-800',
  secondary:
    'bg-white text-slate-700 border border-slate-200 shadow-sm hover:border-brand-300 hover:text-brand-700 hover:bg-brand-50/50 ' +
    'dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:border-brand-500/50 dark:hover:text-brand-400 dark:hover:bg-slate-700/50',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
  danger: 'bg-rose-600 text-white shadow-soft hover:bg-rose-700 active:bg-rose-800',
  success: 'bg-emerald-600 text-white shadow-soft hover:bg-emerald-700 active:bg-emerald-800',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'text-xs px-3 py-1.5 rounded-lg',
  md: 'text-sm px-4 py-2.5 rounded-xl',
  lg: 'text-base px-6 py-3.5 rounded-xl',
}

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className = ''): string {
  return `${base} ${variants[variant]} ${sizes[size]} ${className}`.trim()
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  children: ReactNode
}

export default function Button({ variant = 'primary', size = 'md', className = '', children, ...rest }: ButtonProps) {
  return (
    <button className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </button>
  )
}
