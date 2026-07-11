import { useEffect, useState, FormEvent } from 'react'
import { authApi, Actor, SessionInfo, ROLE_LABELS } from '../api/client'
import Button from '../components/ui/Button'
import { inputClass, labelClass } from '../components/ui/field'
import { cardClass } from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'

type ApiErr = { response?: { data?: { error?: string } } }

export default function Profile() {
  const [actor, setActor] = useState<Actor | null>(null)
  const [name, setName] = useState('')
  const [organization, setOrganization] = useState('')
  const [profileMsg, setProfileMsg] = useState('')
  const [profileErr, setProfileErr] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordMsg, setPasswordMsg] = useState('')
  const [passwordErr, setPasswordErr] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  const [sessions, setSessions] = useState<SessionInfo[]>([])

  const loadSessions = () => authApi.sessions().then(setSessions).catch(() => {})

  useEffect(() => {
    authApi.me().then((a) => {
      setActor(a)
      setName(a.name)
      setOrganization(a.organization)
    }).catch(() => {})
    loadSessions()
  }, [])

  const handleProfileSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setProfileErr('')
    setProfileMsg('')
    setSavingProfile(true)
    try {
      const updated = await authApi.updateProfile({ name, organization })
      setActor(updated)
      setProfileMsg('Đã lưu thông tin')
    } catch (err) {
      setProfileErr((err as ApiErr)?.response?.data?.error ?? 'Cập nhật thất bại')
    } finally {
      setSavingProfile(false)
    }
  }

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setPasswordErr('')
    setPasswordMsg('')
    setSavingPassword(true)
    try {
      await authApi.changePassword({ currentPassword, newPassword })
      setPasswordMsg('Đã đổi mật khẩu')
      setCurrentPassword('')
      setNewPassword('')
    } catch (err) {
      setPasswordErr((err as ApiErr)?.response?.data?.error ?? 'Đổi mật khẩu thất bại')
    } finally {
      setSavingPassword(false)
    }
  }

  const handleRevoke = async (token: string) => {
    await authApi.revokeSession(token).catch(() => {})
    loadSessions()
  }

  return (
    <div className="page-shell">
      <main className="max-w-lg mx-auto p-4 sm:p-6 space-y-4">
        <PageHeader title="Hồ sơ cá nhân" />

        <div className={cardClass({ padding: 'lg' })}>
          <div className="flex items-center gap-3 mb-4">
            <span className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-500 to-emerald-500 text-white flex items-center justify-center text-lg font-bold flex-shrink-0">
              {actor?.name?.charAt(0)?.toUpperCase() ?? '?'}
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Thông tin tài khoản</h2>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                {actor?.email} · {actor ? ROLE_LABELS[actor.role] : ''}
              </p>
            </div>
          </div>
          <form onSubmit={handleProfileSubmit} className="space-y-3">
            <div>
              <label className={labelClass}>Họ tên</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Tổ chức</label>
              <input value={organization} onChange={(e) => setOrganization(e.target.value)} required className={inputClass} />
            </div>
            {profileErr && <p className="text-sm text-rose-600 dark:text-rose-400">{profileErr}</p>}
            {profileMsg && <p className="text-sm text-emerald-600 dark:text-emerald-400">{profileMsg}</p>}
            <Button type="submit" disabled={savingProfile} size="sm">
              {savingProfile ? 'Đang lưu...' : 'Lưu thay đổi'}
            </Button>
          </form>
        </div>

        <div className={cardClass({ padding: 'lg' })}>
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Đổi mật khẩu</h2>
          <form onSubmit={handlePasswordSubmit} className="space-y-3">
            <div>
              <label className={labelClass}>Mật khẩu hiện tại</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Mật khẩu mới</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                className={inputClass}
              />
            </div>
            {passwordErr && <p className="text-sm text-rose-600 dark:text-rose-400">{passwordErr}</p>}
            {passwordMsg && <p className="text-sm text-emerald-600 dark:text-emerald-400">{passwordMsg}</p>}
            <Button type="submit" disabled={savingPassword} size="sm">
              {savingPassword ? 'Đang lưu...' : 'Đổi mật khẩu'}
            </Button>
          </form>
        </div>

        <div className={cardClass({ padding: 'lg' })}>
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Phiên đăng nhập đang hoạt động</h2>
          <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">Thu hồi phiên nếu bạn nghi ngờ mất quyền truy cập thiết bị nào đó.</p>
          {sessions.length === 0 && <p className="text-sm text-slate-400 dark:text-slate-500">Không có phiên nào khác đang hoạt động.</p>}
          <div className="space-y-2">
            {sessions.map((s) => (
              <div key={s.token} className="flex items-center justify-between text-sm bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2.5">
                <div>
                  <p className="font-mono text-xs text-slate-600 dark:text-slate-400">{s.token}…</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Hết hạn {new Date(s.expiresAt).toLocaleString('vi-VN')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevoke(s.token)}
                  className="text-xs text-rose-500 dark:text-rose-400 hover:underline font-medium"
                >
                  Thu hồi
                </button>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
