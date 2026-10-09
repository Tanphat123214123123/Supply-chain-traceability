import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { traceApi } from '../api/client'
import { apiErrorMessage } from '../lib/apiError'
import { buttonClass } from './ui/Button'
import { cardClass } from './ui/Card'
import { inputClass } from './ui/field'

/**
 * Independent verification for this lot: the public check anyone can run,
 * and a time-limited link that opens every field for an auditor or buyer
 * (docs/SPEC_PHASE1.md §6). The link is a bearer token — whoever has it sees
 * the internal fields until it expires.
 */
export default function VerifyPanel({ batchId }: { batchId: string }) {
  const [days, setDays] = useState(7)
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      const { token, expiresAt } = await traceApi.createVerificationLink(batchId, days)
      const url = `${window.location.origin}/verify?batch=${batchId}&token=${encodeURIComponent(token)}`
      setLink({ url, expiresAt })
    } catch (err) {
      setError(apiErrorMessage(err, 'Không tạo được link kiểm chứng.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={cardClass({ className: 'space-y-3' })}>
      <div>
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-500" /> Kiểm chứng độc lập
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Trình duyệt tự tính lại mã băm và đối chiếu với blockchain. Bản công khai chỉ mở các trường được công bố.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <Link to={`/verify?batch=${batchId}`} className={buttonClass('secondary', 'sm')}>
          Mở trang xác minh
        </Link>
        <span className="text-xs text-slate-400">hoặc cấp quyền xem đầy đủ cho kiểm toán viên:</span>
        <select aria-label="Hiệu lực" value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${inputClass} !w-auto !py-1.5 text-xs`}>
          {[1, 7, 14, 30].map((d) => (
            <option key={d} value={d}>
              {d} ngày
            </option>
          ))}
        </select>
        <button type="button" onClick={create} disabled={busy} className={buttonClass('secondary', 'sm')}>
          {busy ? 'Đang tạo...' : 'Tạo link kiểm chứng'}
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      {link && (
        <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-3 space-y-2">
          <code className="block text-[11px] break-all text-slate-600 dark:text-slate-300">{link.url}</code>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Ai có link này xem được mọi trường nội bộ đến {new Date(link.expiresAt).toLocaleString('vi-VN')}. Chỉ gửi cho người cần kiểm tra.
            </p>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(link.url).then(() => (setCopied(true), setTimeout(() => setCopied(false), 2000)))}
              className={buttonClass('primary', 'sm')}
            >
              {copied ? 'Đã sao chép' : 'Sao chép link'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
