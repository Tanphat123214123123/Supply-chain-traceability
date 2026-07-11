import { Link, Navigate } from 'react-router-dom'
import { Link2, Handshake, ShieldCheck, Zap, Smartphone, BarChart3, Sun, Moon, type LucideIcon } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { STAGE_ICONS, STAGE_LABELS, STAGE_ORDER, ROLE_LABELS, ActorRole } from '../api/client'
import { buttonClass } from '../components/ui/Button'
import { cardClass } from '../components/ui/Card'

const FEATURES: Array<{ icon: LucideIcon; title: string; description: string }> = [
  {
    icon: Link2,
    title: 'Chuỗi hash bất biến',
    description: 'Mỗi sự kiện được ký HMAC-SHA256 nối tiếp — sửa một bản ghi cũ sẽ làm sai lệch toàn bộ chuỗi phía sau, phát hiện được ngay.',
  },
  {
    icon: Handshake,
    title: 'Bàn giao rõ ràng từng khâu',
    description: 'Lô hàng chỉ được xử lý bởi đúng người được bàn giao — không ai "tiện tay" ghi đè lên lô hàng không thuộc trách nhiệm của mình.',
  },
  {
    icon: ShieldCheck,
    title: 'Phân quyền theo vai trò',
    description: 'Nông dân, nhà chế biến, kiểm định viên, phân phối, bán lẻ — mỗi vai trò chỉ thao tác đúng phạm vi của mình.',
  },
  {
    icon: Zap,
    title: 'Cảnh báo bất thường tức thời',
    description: 'Bỏ khâu, trùng khâu, sai thứ tự đều được phát hiện tự động và đẩy thông báo real-time cho người giám sát.',
  },
  {
    icon: Smartphone,
    title: 'Tra cứu công khai bằng QR',
    description: 'Người tiêu dùng quét mã QR trên bao bì là thấy toàn bộ hành trình sản phẩm — không cần tài khoản.',
  },
  {
    icon: BarChart3,
    title: 'Báo cáo & kiểm toán đầy đủ',
    description: 'Thống kê theo khâu, theo vùng, xuất báo cáo CSV, và nhật ký kiểm toán ghi lại mọi thao tác trong hệ thống.',
  },
]

const ROLES: ActorRole[] = ['FARMER', 'PROCESSOR', 'INSPECTOR', 'DISTRIBUTOR', 'RETAILER']

export default function Landing() {
  const { actor, isLoading } = useAuth()
  const { theme, toggleTheme } = useTheme()

  if (!isLoading && actor) return <Navigate to="/dashboard" replace />

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 overflow-x-hidden">
      {/* Nav */}
      <header className="border-b border-slate-100 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-bold text-slate-900 dark:text-slate-50 text-lg">
            <Link2 className="w-6 h-6 text-brand-600 dark:text-brand-400" /> TraceChain
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/how-it-works" className="hidden sm:inline-flex text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 px-3 py-2">
              Cách hoạt động
            </Link>
            <Link to="/verify" className="hidden sm:inline-flex text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 px-3 py-2">
              Xác minh chuỗi
            </Link>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
              className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <Link to="/login" className={buttonClass('ghost', 'sm')}>Đăng nhập</Link>
            <Link to="/register" className={buttonClass('primary', 'sm')}>Đăng ký</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative">
        <div
          className="absolute inset-0 -z-10 bg-grid-pattern [background-size:32px_32px]"
          style={{ maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)' }}
        />
        <div className="absolute -top-24 right-0 -z-10 w-[36rem] h-[36rem] bg-brand-100 dark:bg-brand-500/10 rounded-full blur-3xl opacity-40 dark:opacity-100" />
        <div className="absolute -top-10 -left-20 -z-10 w-[28rem] h-[28rem] bg-emerald-100 dark:bg-emerald-500/10 rounded-full blur-3xl opacity-40 dark:opacity-100" />

        <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-20 text-center">
          <div className="inline-flex items-center gap-2 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400 text-xs font-semibold px-3 py-1.5 rounded-full ring-1 ring-brand-600/10 dark:ring-brand-500/20 animate-fade-in">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Minh bạch từ nông trại đến bàn ăn
          </div>

          <h1 className="mt-6 text-4xl sm:text-6xl font-bold tracking-tight text-slate-900 dark:text-slate-50 animate-slide-up [animation-delay:80ms]">
            Truy xuất nguồn gốc <br className="hidden sm:block" />
            <span className="bg-gradient-to-r from-brand-600 via-brand-500 to-emerald-500 bg-clip-text text-transparent">
              không thể làm giả
            </span>
          </h1>

          <p className="mt-6 text-base sm:text-lg text-slate-500 dark:text-slate-400 max-w-2xl mx-auto animate-slide-up [animation-delay:160ms]">
            TraceChain ghi lại từng khâu của chuỗi cung ứng bằng một chuỗi hash liên kết, phân quyền chặt chẽ theo
            vai trò và bàn giao custody rõ ràng — để mọi lô hàng đều có một câu chuyện thật, kiểm chứng được.
          </p>

          <div className="mt-8 flex items-center justify-center gap-3 flex-wrap animate-slide-up [animation-delay:240ms]">
            <Link to="/register" className={buttonClass('primary', 'lg', 'shadow-glow')}>
              Bắt đầu miễn phí →
            </Link>
            <Link to="/how-it-works" className={buttonClass('secondary', 'lg')}>
              Xem cách hoạt động
            </Link>
          </div>

          {/* Stage strip */}
          <div className="mt-16 flex items-center justify-center gap-1 sm:gap-2 flex-wrap animate-slide-up [animation-delay:320ms]">
            {STAGE_ORDER.map((s, i) => {
              const StageIcon = STAGE_ICONS[s]
              return (
              <div key={s} className="flex items-center gap-1 sm:gap-2">
                <div className={cardClass({ padding: 'sm', className: 'flex items-center gap-2 !rounded-full' })}>
                  <StageIcon className="w-4 h-4 text-brand-600 dark:text-brand-400" />
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300 hidden sm:inline">{STAGE_LABELS[s]}</span>
                </div>
                {i < STAGE_ORDER.length - 1 && <span className="text-slate-300 dark:text-slate-600 text-sm">→</span>}
              </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="text-center max-w-xl mx-auto mb-12">
          <p className="text-xs font-semibold text-brand-600 dark:text-brand-400 tracking-wide uppercase mb-2">Tại sao TraceChain</p>
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">
            Được thiết kế cho niềm tin, không phải lời hứa
          </h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className={cardClass({ hover: true, padding: 'lg' })}>
              <div className="w-11 h-11 rounded-xl bg-brand-50 dark:bg-brand-500/10 flex items-center justify-center text-brand-600 dark:text-brand-400 mb-4">
                <f.icon className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-1.5">{f.title}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Roles */}
      <section className="bg-slate-50 dark:bg-slate-900/50 border-y border-slate-100 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <div className="text-center max-w-xl mx-auto mb-12">
            <p className="text-xs font-semibold text-brand-600 dark:text-brand-400 tracking-wide uppercase mb-2">Một mạng lưới, nhiều vai trò</p>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">
              Mỗi mắt xích đều có trách nhiệm riêng
            </h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {ROLES.map((r, i) => (
              <div
                key={r}
                className={cardClass({ padding: 'md', className: 'text-center animate-scale-in' })}
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="w-10 h-10 mx-auto rounded-full bg-gradient-to-br from-brand-500 to-emerald-500 text-white flex items-center justify-center font-bold text-sm mb-2">
                  {i + 1}
                </div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{ROLE_LABELS[r]}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-20 sm:py-28 text-center">
        <h2 className="text-2xl sm:text-4xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">
          Sẵn sàng làm cho chuỗi cung ứng của bạn minh bạch?
        </h2>
        <p className="mt-4 text-slate-500 dark:text-slate-400 max-w-lg mx-auto">
          Tạo tài khoản trong chưa đầy một phút — không cần thẻ tín dụng, không ràng buộc.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
          <Link to="/register" className={buttonClass('primary', 'lg', 'shadow-glow')}>
            Đăng ký ngay
          </Link>
          <Link to="/login" className={buttonClass('secondary', 'lg')}>
            Tôi đã có tài khoản
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-slate-400 dark:text-slate-500">
          <p>© {new Date().getFullYear()} TraceChain — Hệ thống truy xuất nguồn gốc chuỗi cung ứng</p>
          <div className="flex items-center gap-4">
            <Link to="/how-it-works" className="hover:text-slate-600 dark:hover:text-slate-300">Cách hoạt động</Link>
            <Link to="/verify" className="hover:text-slate-600 dark:hover:text-slate-300">Xác minh chuỗi</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
