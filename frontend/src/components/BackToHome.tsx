import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

/** "Back to the landing page" for the standalone auth screens (no nav bar there). */
export default function BackToHome({ className = '' }: { className?: string }) {
  return (
    <Link
      to="/"
      className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800 transition-colors ${className}`}
    >
      <ArrowLeft className="w-4 h-4" /> Về trang chủ
    </Link>
  )
}
