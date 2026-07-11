import { useState, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Search, CheckCircle2, XCircle } from 'lucide-react'
import { traceApi, FullVerifyResult, STAGE_LABELS } from '../api/client'
import Button from '../components/ui/Button'
import { inputClass } from '../components/ui/field'
import { cardClass } from '../components/ui/Card'

type ApiErr = { response?: { data?: { error?: string } } }

export default function ChainVerifier() {
  const [batchId, setBatchId] = useState('')
  const [result, setResult] = useState<FullVerifyResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setResult(null)
    setLoading(true)
    try {
      const data = await traceApi.verifyFull(batchId.trim())
      setResult(data)
    } catch (err) {
      setError((err as ApiErr)?.response?.data?.error ?? 'Không tìm thấy lô hàng')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-shell p-4">
      <div className="max-w-2xl mx-auto py-8 space-y-4">
        <div className="text-center animate-slide-up">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-brand-500 to-emerald-500 flex items-center justify-center text-white mb-4 shadow-glow">
            <Search className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">Công cụ xác minh chuỗi độc lập</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-md mx-auto">
            Không cần tin vào TraceChain — công cụ này hiển thị đầy đủ phép tính hash từng bước để bạn (hoặc kiểm
            toán viên) tự xác minh dữ liệu không bị can thiệp.
          </p>
        </div>

        <form onSubmit={handleSubmit} className={cardClass({ className: 'flex gap-2' })}>
          <input
            type="text"
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            placeholder="Nhập ID lô hàng..."
            required
            className={`${inputClass} font-mono`}
          />
          <Button type="submit" disabled={loading}>
            {loading ? 'Đang kiểm tra...' : 'Xác minh'}
          </Button>
        </form>

        {error && (
          <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-sm rounded-xl px-3 py-2.5 text-center animate-scale-in">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-3 animate-slide-up">
            <div className={`rounded-2xl p-5 text-center ${result.valid ? 'bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20' : 'bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20'}`}>
              <p className={`font-semibold flex items-center justify-center gap-1.5 ${result.valid ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                {result.valid ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> Toàn bộ chuỗi hợp lệ — không có dấu hiệu can thiệp
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 flex-shrink-0" /> Phát hiện sai lệch tại sự kiện thứ {(result.brokenAtIndex ?? 0) + 1}
                  </>
                )}
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{result.batch.productName}</p>
            </div>

            <div className={cardClass({ padding: 'none', className: 'divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden' })}>
              {result.events.map((e, i) => {
                const check = result.perEvent[i]
                const ok = check?.matchesStoredHash && check?.linksToPrevious
                return (
                  <div key={e.id} className="p-3.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-50">
                        #{e.sequenceNumber} — {STAGE_LABELS[e.stage]}
                      </span>
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400'}`}>
                        {ok ? <><CheckCircle2 className="w-3 h-3" /> khớp</> : <><XCircle className="w-3 h-3" /> sai lệch</>}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 dark:text-slate-500 font-mono break-all">hash lưu: {e.hash}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 font-mono break-all">hash tính lại: {check?.recomputedHash}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 font-mono break-all">prevHash: {e.prevHash}</p>
                  </div>
                )
              })}
            </div>

            <p className="text-center">
              <Link to={`/provenance/${result.batch.id}`} className="text-sm text-brand-600 dark:text-brand-400 hover:underline font-medium">
                Xem trang tra cứu công khai →
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
