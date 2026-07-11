import { useState, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Link2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { STAGE_ICONS, STAGE_LABELS, STAGE_ORDER } from '../api/client'
import Button from '../components/ui/Button'
import { inputClass, labelClass } from '../components/ui/field'

type ApiErr = { response?: { data?: { error?: string } } }

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate('/dashboard')
    } catch (err) {
      setError((err as ApiErr)?.response?.data?.error ?? 'Đăng nhập thất bại')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-white dark:bg-slate-950">
      {/* Brand panel — deliberately kept on its own fixed brand gradient in both
          themes (not `page-shell`/slate-based) so it doesn't wash out; only the
          decorative blur blobs are dimmed for dark mode. */}
      <div className="hidden lg:flex relative flex-col justify-between bg-gradient-to-br from-brand-700 via-brand-600 to-emerald-600 dark:from-brand-800 dark:via-brand-700 dark:to-emerald-700 p-10 text-white overflow-hidden">
        <div className="absolute -top-20 -right-20 w-96 h-96 bg-white/10 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-0 left-0 w-72 h-72 bg-emerald-300/20 rounded-full blur-3xl" />

        <Link to="/" className="relative flex items-center gap-2 text-lg font-bold">
          <Link2 className="w-6 h-6" /> TraceChain
        </Link>

        <div className="relative">
          <h2 className="text-3xl font-bold tracking-tight max-w-sm">
            Mỗi lô hàng, một câu chuyện kiểm chứng được.
          </h2>
          <p className="mt-3 text-brand-100 max-w-sm text-sm">
            Đăng nhập để ghi nhận, giám sát và tra cứu toàn bộ hành trình sản phẩm trong chuỗi cung ứng.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            {STAGE_ORDER.map((s) => {
              const StageIcon = STAGE_ICONS[s]
              return (
              <span key={s} className="inline-flex items-center gap-1.5 bg-white/10 backdrop-blur-sm text-xs font-medium px-3 py-1.5 rounded-full">
                <StageIcon className="w-3.5 h-3.5" /> {STAGE_LABELS[s]}
              </span>
              )
            })}
          </div>
        </div>

        <p className="relative text-xs text-brand-200">© {new Date().getFullYear()} TraceChain</p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm animate-slide-up">
          <div className="lg:hidden text-center mb-8">
            <Link to="/" className="inline-flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-slate-50">
              <Link2 className="w-7 h-7 text-brand-600 dark:text-brand-400" /> TraceChain
            </Link>
          </div>

          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">Chào mừng trở lại</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-8">Đăng nhập để tiếp tục quản lý chuỗi cung ứng của bạn.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={labelClass}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="you@example.com"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Mật khẩu</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className={inputClass}
              />
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400 text-sm rounded-xl px-3.5 py-2.5 animate-scale-in">
                {error}
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full" size="md">
              {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
            </Button>
          </form>

          <p className="text-center text-sm text-slate-500 dark:text-slate-400 mt-6">
            Chưa có tài khoản?{' '}
            <Link to="/register" className="text-brand-600 dark:text-brand-400 hover:underline font-medium">Đăng ký</Link>
          </p>

          {/* Demo credentials hint — dev server only. A production build (import.meta.env.DEV
              is statically false then) never ships this, so a real deployment can't advertise
              a walk-in admin login unless SEED_DEMO_DATA was also explicitly opted into on the backend. */}
          {import.meta.env.DEV && (
            <div className="mt-6 p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Tài khoản demo (mật khẩu: demo1234)</p>
              <div className="grid grid-cols-2 gap-1 text-xs text-slate-400 dark:text-slate-500 font-mono">
                <span>farmer@demo.com</span>
                <span>processor@demo.com</span>
                <span>inspector@demo.com</span>
                <span>distributor@demo.com</span>
                <span>retailer@demo.com</span>
                <span>admin@demo.com</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
