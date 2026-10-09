import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Building2, CircleCheck, Link2, Ticket } from 'lucide-react'
import { authApi, InvitationPreview, ROLE_LABELS } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { apiErrorMessage } from '../lib/apiError'
import Button from '../components/ui/Button'
import { inputClass, labelClass } from '../components/ui/field'
import BackToHome from '../components/BackToHome'

type Mode = 'invite' | 'workspace'

/** "Hợp tác xã Cầu Đất" → "hop-tac-xa-cau-dat" */
function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/**
 * Two honest ways in — and in neither does the registrant pick their own role:
 *   • "Tôi có mã mời": an admin invited you; the invitation decides the role.
 *   • "Tạo không gian mới": you're setting TraceChain up for your company and
 *     become its administrator, then invite your partners.
 */
export default function Register() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState<Mode>(searchParams.get('invite') || searchParams.get('mode') !== 'workspace' ? 'invite' : 'workspace')

  const [inviteCode, setInviteCode] = useState(searchParams.get('invite') ?? '')
  const [preview, setPreview] = useState<InvitationPreview | null>(null)
  const [checking, setChecking] = useState(false)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [organization, setOrganization] = useState('')
  const [tenantName, setTenantName] = useState('')
  const [tenantSlug, setTenantSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const checkInvite = async (code: string) => {
    if (code.trim().length < 8) return
    setChecking(true)
    setError('')
    setPreview(null)
    try {
      const p = await authApi.previewInvitation(code)
      setPreview(p)
      if (p.email) setEmail(p.email)
    } catch (err) {
      setError(apiErrorMessage(err, 'Không kiểm tra được mã mời.'))
    } finally {
      setChecking(false)
    }
  }

  // Arriving from an invitation link: look the code up immediately.
  useEffect(() => {
    const fromLink = searchParams.get('invite')
    if (fromLink) checkInvite(fromLink)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!slugEdited) setTenantSlug(slugify(tenantName))
  }, [tenantName, slugEdited])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const base = { name: name.trim(), email: email.trim(), password, organization: organization.trim() }
      await authApi.register(
        mode === 'invite'
          ? { mode, ...base, inviteCode: inviteCode.trim() }
          : { mode, ...base, tenantName: tenantName.trim(), tenantSlug },
      )
      await login(base.email, password)
      navigate(mode === 'workspace' ? '/actors?welcome=1' : '/dashboard', { replace: true })
    } catch (err) {
      setError(apiErrorMessage(err, 'Đăng ký thất bại. Thử lại sau.'))
    } finally {
      setLoading(false)
    }
  }

  const tab = (value: Mode, label: string, Icon: typeof Ticket) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === value}
      onClick={() => {
        setMode(value)
        setError('')
      }}
      className={`flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-lg transition-colors ${
        mode === value
          ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-slate-50 font-medium'
          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
      }`}
    >
      <Icon className="w-4 h-4" /> {label}
    </button>
  )

  const showAccountFields = mode === 'workspace' || preview !== null

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute -top-32 -right-32 w-96 h-96 bg-brand-100 dark:bg-brand-500/10 rounded-full blur-3xl opacity-50 dark:opacity-100 -z-10" />
      <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-emerald-100 dark:bg-emerald-500/10 rounded-full blur-3xl opacity-50 dark:opacity-100 -z-10" />
      <BackToHome className="absolute top-4 left-4 sm:top-6 sm:left-6" />

      <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-glow dark:shadow-none border border-slate-100 dark:border-slate-800 w-full max-w-sm p-7 animate-slide-up">
        <div className="text-center mb-5">
          <Link to="/" className="inline-flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-slate-50" aria-label="TraceChain">
            <Link2 className="w-7 h-7 text-brand-600 dark:text-brand-400" />
          </Link>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50 mt-2">Tạo tài khoản</h1>
        </div>

        <div role="tablist" className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1 mb-5">
          {tab('invite', 'Tôi có mã mời', Ticket)}
          {tab('workspace', 'Tạo không gian mới', Building2)}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {mode === 'invite' ? (
            <div>
              <label htmlFor="invite" className={labelClass}>
                Mã mời
              </label>
              <div className="flex gap-2">
                <input
                  id="invite"
                  value={inviteCode}
                  onChange={(e) => {
                    setInviteCode(e.target.value.toUpperCase())
                    setPreview(null)
                  }}
                  onBlur={() => !preview && checkInvite(inviteCode)}
                  required
                  autoFocus={!searchParams.get('invite')}
                  placeholder="XXXX-XXXX-XXXX"
                  autoComplete="off"
                  className={`${inputClass} font-mono tracking-wider`}
                />
                {!preview && (
                  <Button type="button" variant="secondary" onClick={() => checkInvite(inviteCode)} disabled={checking || inviteCode.trim().length < 8}>
                    {checking ? '...' : 'Kiểm tra'}
                  </Button>
                )}
              </div>
              {preview ? (
                <div className="mt-2 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl p-3 text-sm text-emerald-800 dark:text-emerald-300 flex gap-2">
                  <CircleCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <p>
                    Bạn được mời vào <strong>{preview.tenantName}</strong> với vai trò <strong>{ROLE_LABELS[preview.role]}</strong>.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                  Quản trị viên của đơn vị bạn hợp tác sẽ gửi mã này. Chưa có? Hãy liên hệ họ.
                </p>
              )}
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 rounded-xl p-3">
                Dành cho đơn vị bắt đầu dùng TraceChain. Bạn sẽ là <strong>quản trị viên</strong>, rồi mời nông hộ, nhà chế biến, kiểm định,
                phân phối tham gia.
              </p>
              <div>
                <label htmlFor="tenantName" className={labelClass}>
                  Tên không gian làm việc
                </label>
                <input
                  id="tenantName"
                  value={tenantName}
                  onChange={(e) => setTenantName(e.target.value)}
                  required
                  autoFocus
                  maxLength={200}
                  placeholder="VD: Chuỗi cà phê Cầu Đất"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="tenantSlug" className={labelClass}>
                  Mã không gian
                </label>
                <input
                  id="tenantSlug"
                  value={tenantSlug}
                  onChange={(e) => {
                    setSlugEdited(true)
                    setTenantSlug(slugify(e.target.value))
                  }}
                  required
                  minLength={2}
                  pattern="[a-z0-9-]+"
                  className={`${inputClass} font-mono`}
                />
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Định danh duy nhất, chỉ gồm chữ thường, số và dấu gạch ngang.</p>
              </div>
            </>
          )}

          {showAccountFields && (
            <>
              <div>
                <label htmlFor="name" className={labelClass}>
                  Họ tên
                </label>
                <input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} autoComplete="name" className={inputClass} />
              </div>
              <div>
                <label htmlFor="organization" className={labelClass}>
                  Đơn vị của bạn
                </label>
                <input
                  id="organization"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  required
                  maxLength={200}
                  placeholder="VD: HTX Nông nghiệp Cầu Đất"
                  autoComplete="organization"
                  className={inputClass}
                />
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Tên này hiển thị trên trang tra cứu công khai.</p>
              </div>
              <div>
                <label htmlFor="email" className={labelClass}>
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  readOnly={!!preview?.email}
                  autoComplete="email"
                  placeholder="ban@congty.vn"
                  className={`${inputClass} ${preview?.email ? 'opacity-70' : ''}`}
                />
              </div>
              <div>
                <label htmlFor="password" className={labelClass}>
                  Mật khẩu
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="Tối thiểu 8 ký tự"
                  className={inputClass}
                />
              </div>
            </>
          )}

          {error && (
            <div role="alert" className="bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400 text-sm rounded-xl px-3.5 py-2.5">
              {error}
            </div>
          )}

          {showAccountFields && (
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Đang tạo tài khoản...' : mode === 'workspace' ? 'Tạo không gian & tài khoản' : 'Tham gia'}
            </Button>
          )}
        </form>

        <p className="text-center text-sm text-slate-500 dark:text-slate-400 mt-6">
          Đã có tài khoản?{' '}
          <Link to="/login" className="text-brand-600 dark:text-brand-400 hover:underline font-medium">
            Đăng nhập
          </Link>
        </p>
      </div>
    </div>
  )
}
