import { useState, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Link2, CircleCheck } from 'lucide-react'
import { authApi, ActorRole, ROLE_LABELS } from '../api/client'
import Button from '../components/ui/Button'
import { inputClass, labelClass } from '../components/ui/field'

type ApiErr = { response?: { data?: { error?: string } } }

const ROLES: ActorRole[] = ['FARMER', 'PROCESSOR', 'INSPECTOR', 'DISTRIBUTOR', 'RETAILER']

export default function Register() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [organization, setOrganization] = useState('')
  const [tenantSlug, setTenantSlug] = useState('')
  const [tenantName, setTenantName] = useState('')
  const [role, setRole] = useState<ActorRole | ''>('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!role) return
    setError('')
    setLoading(true)
    try {
      await authApi.register({ name, email, password, role, organization, tenantSlug, tenantName: tenantName || undefined })
      setSuccess(true)
      setTimeout(() => navigate('/login'), 1500)
    } catch (err) {
      setError((err as ApiErr)?.response?.data?.error ?? 'Đăng ký thất bại')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute -top-32 -right-32 w-96 h-96 bg-brand-100 dark:bg-brand-500/10 rounded-full blur-3xl opacity-50 dark:opacity-100 -z-10" />
      <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-emerald-100 dark:bg-emerald-500/10 rounded-full blur-3xl opacity-50 dark:opacity-100 -z-10" />

      <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-glow dark:shadow-none border border-slate-100 dark:border-slate-800 w-full max-w-sm p-8 animate-slide-up">
        <div className="text-center mb-7">
          <Link to="/" className="inline-flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-slate-50">
            <Link2 className="w-7 h-7 text-brand-600 dark:text-brand-400" />
          </Link>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50 mt-2">Tạo tài khoản mới</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Tham gia mạng lưới truy xuất nguồn gốc TraceChain</p>
        </div>

        {success ? (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400 text-sm rounded-xl px-3 py-4 text-center animate-scale-in flex items-center justify-center gap-1.5">
            <CircleCheck className="w-4 h-4 flex-shrink-0" /> Đăng ký thành công! Đang chuyển đến trang đăng nhập...
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className={labelClass}>Họ tên</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
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
                minLength={8}
                placeholder="Tối thiểu 8 ký tự"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Tổ chức</label>
              <input
                type="text"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                required
                placeholder="VD: Nông trại Đà Lạt"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Mã không gian làm việc</label>
              <input
                type="text"
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value)}
                required
                placeholder="VD: acme-coffee"
                pattern="[a-z0-9-]+"
                className={inputClass}
              />
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                Nếu mã đã tồn tại bạn sẽ gia nhập; nếu chưa, bạn sẽ tạo mới và trở thành quản trị viên.
              </p>
            </div>

            <div>
              <label className={labelClass}>Tên không gian làm việc (nếu tạo mới)</label>
              <input
                type="text"
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
                placeholder="VD: Acme Coffee Co."
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Vai trò</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as ActorRole)}
                required
                aria-label="Chọn vai trò"
                className={inputClass}
              >
                <option value="">— Chọn vai trò —</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400 text-sm rounded-xl px-3.5 py-2.5 animate-scale-in">
                {error}
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Đang đăng ký...' : 'Đăng ký'}
            </Button>
          </form>
        )}

        <p className="text-center text-sm text-slate-500 dark:text-slate-400 mt-6">
          Đã có tài khoản?{' '}
          <Link to="/login" className="text-brand-600 dark:text-brand-400 hover:underline font-medium">Đăng nhập</Link>
        </p>
      </div>
    </div>
  )
}
