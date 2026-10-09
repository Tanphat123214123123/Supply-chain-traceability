import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

/**
 * "Back" for the standalone public pages (no nav bar). Goes back in history
 * when the visitor came from inside the app; someone who opened the page
 * straight from a QR code or a shared link has no such history, so they go
 * to `fallback` instead of leaving the site.
 */
export default function BackButton({ fallback, className = '' }: { fallback: string; className?: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const hasHistory = location.key !== 'default'
  return (
    <button
      type="button"
      onClick={() => (hasHistory ? navigate(-1) : navigate(fallback))}
      className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800 transition-colors ${className}`}
    >
      <ArrowLeft className="w-4 h-4" /> Quay lại
    </button>
  )
}
