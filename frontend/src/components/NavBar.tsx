import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  PenSquare,
  ListChecks,
  Users,
  BarChart3,
  Bell,
  ShieldAlert,
  ScrollText,
  Link2,
  Menu,
  X,
  LogOut,
  Sun,
  Moon,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { ROLE_LABELS } from '../api/client'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-1 text-[13px] px-1.5 py-2 rounded-lg whitespace-nowrap transition-colors font-medium ${
    isActive
      ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
  }`

// "Cách hoạt động" deliberately isn't here — it's pre-signup education content
// (already linked from Landing's own nav/footer), not something a logged-in
// user needs competing for space in their daily work nav.
const NAV_ITEMS: Array<{ to: string; label: string; icon: LucideIcon; end?: boolean; adminOnly?: boolean }> = [
  { to: '/dashboard', label: 'Tổng quan', icon: LayoutDashboard, end: true },
  { to: '/record', label: 'Ghi sự kiện', icon: PenSquare },
  { to: '/tasks', label: 'Việc cần làm', icon: ListChecks },
  { to: '/actors', label: 'Đối tác', icon: Users },
  { to: '/reports', label: 'Báo cáo', icon: BarChart3 },
  { to: '/notifications', label: 'Thông báo', icon: Bell },
  { to: '/admin/anomalies', label: 'Bất thường', icon: ShieldAlert, adminOnly: true },
  { to: '/admin/audit-logs', label: 'Nhật ký', icon: ScrollText, adminOnly: true },
]

export default function NavBar() {
  const { actor, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const isAdmin = actor?.role === 'ADMIN'
  const [mobileOpen, setMobileOpen] = useState(false)

  const items = NAV_ITEMS.filter((i) => !i.adminOnly || isAdmin)

  return (
    <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 sticky top-0 z-20">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 h-14 flex items-center gap-1">
        <NavLink to="/dashboard" className="flex items-center gap-1.5 text-base font-bold text-slate-900 dark:text-slate-50 mr-0.5 flex-shrink-0">
          <Link2 className="w-5 h-5 text-brand-600 dark:text-brand-400" />
          <span className="hidden sm:inline">TraceChain</span>
        </NavLink>

        <nav className="hidden lg:flex items-center overflow-x-auto flex-1 min-w-0">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
              <item.icon className="w-3.5 h-3.5 flex-shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex-1 lg:hidden" />

        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
            className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <NavLink
            to="/profile"
            className="hidden sm:flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 hover:text-brand-700 dark:hover:text-brand-400 pl-1 pr-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <span className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-500 to-emerald-500 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
              {actor?.name?.charAt(0)?.toUpperCase() ?? '?'}
            </span>
            <span className="hidden xl:block">
              {actor?.name}
              <span className="text-slate-400 dark:text-slate-500 ml-1">· {actor ? ROLE_LABELS[actor.role] : ''}</span>
            </span>
          </NavLink>
          <button
            onClick={logout}
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 transition-colors px-2 py-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-500/10"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden md:inline">Đăng xuất</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Mở menu"
            className="lg:hidden text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav className="lg:hidden border-t border-slate-100 dark:border-slate-800 px-4 py-2 flex flex-col gap-0.5 animate-slide-up">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMobileOpen(false)}
              className={linkClass}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </NavLink>
          ))}
          <NavLink to="/profile" onClick={() => setMobileOpen(false)} className={linkClass}>
            <Users className="w-4 h-4" />
            Hồ sơ ({actor?.name})
          </NavLink>
        </nav>
      )}
    </header>
  )
}
