import { FormEvent, useEffect, useState } from 'react'
import { Copy, Check, UserPlus } from 'lucide-react'
import { adminApi, ActorRole, Invitation, ROLE_LABELS } from '../api/client'
import { apiErrorMessage } from '../lib/apiError'
import Button from './ui/Button'
import Badge from './ui/Badge'
import { cardClass } from './ui/Card'
import { inputClass, labelClass } from './ui/field'

const INVITABLE: ActorRole[] = ['FARMER', 'PROCESSOR', 'INSPECTOR', 'DISTRIBUTOR', 'RETAILER', 'ADMIN']

function status(inv: Invitation): { label: string; tone: 'success' | 'neutral' | 'warning' | 'brand' } {
  if (inv.usedAt) return { label: 'Đã dùng', tone: 'success' }
  if (inv.revokedAt) return { label: 'Đã huỷ', tone: 'neutral' }
  if (new Date(inv.expiresAt) < new Date()) return { label: 'Hết hạn', tone: 'warning' }
  return { label: 'Đang chờ', tone: 'brand' }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 2000)
        })
      }
      className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
    >
      {done ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {done ? 'Đã sao chép' : label}
    </button>
  )
}

/**
 * ADMIN-only: membership is by invitation. The admin decides the role; the
 * code (shown once) or its link is sent to the partner however they like —
 * Zalo, email, printed on paper.
 */
export default function InvitePanel() {
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [role, setRole] = useState<ActorRole>('FARMER')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [expiresInDays, setExpiresInDays] = useState(7)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [issued, setIssued] = useState<{ code: string; role: ActorRole } | null>(null)

  const load = () => adminApi.invitations().then(setInvitations).catch(() => {})
  useEffect(() => {
    load()
  }, [])

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { code, invitation } = await adminApi.createInvitation({
        role,
        email: email.trim() || undefined,
        note: note.trim() || undefined,
        expiresInDays,
      })
      setIssued({ code, role: invitation.role })
      setEmail('')
      setNote('')
      load()
    } catch (err) {
      setError(apiErrorMessage(err, 'Không tạo được lời mời.'))
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (id: string) => {
    try {
      await adminApi.revokeInvitation(id)
      load()
    } catch (err) {
      setError(apiErrorMessage(err, 'Không huỷ được lời mời.'))
    }
  }

  const link = issued ? `${window.location.origin}/register?invite=${issued.code}` : ''

  return (
    <section className={cardClass({ className: 'space-y-4' })} aria-labelledby="invite-heading">
      <h2 id="invite-heading" className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
        <UserPlus className="w-4 h-4" /> Mời thành viên
      </h2>

      <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="inv-role" className={labelClass}>
            Vai trò
          </label>
          <select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as ActorRole)} className={inputClass}>
            {INVITABLE.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="inv-expiry" className={labelClass}>
            Hiệu lực
          </label>
          <select id="inv-expiry" value={expiresInDays} onChange={(e) => setExpiresInDays(Number(e.target.value))} className={inputClass}>
            <option value={1}>1 ngày</option>
            <option value={7}>7 ngày</option>
            <option value={30}>30 ngày</option>
          </select>
        </div>
        <div>
          <label htmlFor="inv-email" className={labelClass}>
            Chỉ cho email (tuỳ chọn)
          </label>
          <input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="doitac@congty.vn" className={inputClass} />
        </div>
        <div>
          <label htmlFor="inv-note" className={labelClass}>
            Ghi chú (tuỳ chọn)
          </label>
          <input id="inv-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="VD: Anh Tuấn – xưởng Bảo Lộc" className={inputClass} />
        </div>
        {role === 'ADMIN' && (
          <p className="sm:col-span-2 text-xs text-amber-600 dark:text-amber-400">
            Quản trị viên có toàn quyền: mời thành viên, khoá tài khoản, thu hồi lô hàng.
          </p>
        )}
        {error && (
          <p role="alert" className="sm:col-span-2 text-sm text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy}>
            {busy ? 'Đang tạo...' : 'Tạo mã mời'}
          </Button>
        </div>
      </form>

      {issued && (
        <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl p-4">
          <p className="text-sm text-emerald-800 dark:text-emerald-300">
            Mã mời cho <strong>{ROLE_LABELS[issued.role]}</strong> — chỉ hiển thị một lần, hãy gửi ngay:
          </p>
          <p className="font-mono text-xl tracking-widest font-semibold text-slate-900 dark:text-slate-50 mt-2 select-all">{issued.code}</p>
          <div className="flex gap-4 mt-2">
            <CopyButton text={issued.code} label="Sao chép mã" />
            <CopyButton text={link} label="Sao chép link đăng ký" />
          </div>
        </div>
      )}

      {invitations.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Lời mời gần đây</h3>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {invitations.slice(0, 10).map((inv) => {
              const s = status(inv)
              return (
                <li key={inv.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-slate-800 dark:text-slate-100">
                      {ROLE_LABELS[inv.role]}
                      {inv.email && <span className="text-slate-400"> · {inv.email}</span>}
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      {inv.note ? `${inv.note} · ` : ''}tạo {new Date(inv.createdAt).toLocaleDateString('vi-VN')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge tone={s.tone}>{s.label}</Badge>
                    {s.label === 'Đang chờ' && (
                      <button type="button" onClick={() => revoke(inv.id)} className="text-xs text-rose-600 dark:text-rose-400 hover:underline">
                        Huỷ
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
