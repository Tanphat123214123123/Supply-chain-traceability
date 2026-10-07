import { FormEvent, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Batch, batchApi } from '../api/client'
import { apiErrorMessage } from '../lib/apiError'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { inputClass, labelClass } from './ui/field'

const REASONS = [
  'Dư lượng thuốc bảo vệ thực vật vượt ngưỡng',
  'Nhiễm vi sinh / nấm mốc',
  'Không đạt kiểm định chất lượng',
  'Sai nhãn, sai thông tin nguồn gốc',
  'Hư hỏng trong vận chuyển / bảo quản',
  'Khác',
] as const

interface RecallDialogProps {
  batch: Pick<Batch, 'id' | 'productName' | 'quantity' | 'unit'>
  open: boolean
  onClose: () => void
  onRecalled: () => void
  /** Pre-selects a reason, e.g. right after a failed quality check. */
  initialReason?: (typeof REASONS)[number]
}

/**
 * Recall is irreversible and immediately visible to every partner and to the
 * public QR page — so it gets a real confirmation: a categorized reason (for
 * reporting), details, and an explicit acknowledgement of the consequences.
 */
export default function RecallDialog({ batch, open, onClose, onRecalled, initialReason }: RecallDialogProps) {
  const [category, setCategory] = useState<string>(initialReason ?? '')
  const [details, setDetails] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reason = [category, details.trim()].filter(Boolean).join(' — ')
  const canSubmit = category !== '' && (category !== 'Khác' || details.trim() !== '') && acknowledged

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError('')
    try {
      await batchApi.recall(batch.id, reason)
      onRecalled()
    } catch (err) {
      setError(apiErrorMessage(err, 'Thu hồi lô hàng thất bại. Thử lại sau.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title="Thu hồi lô hàng" onClose={onClose} busy={busy}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl p-3 text-sm text-rose-800 dark:text-rose-300 flex gap-2">
          <TriangleAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">
              {batch.productName} · {batch.quantity} {batch.unit}
            </p>
            <p className="mt-1">Sau khi thu hồi:</p>
            <ul className="list-disc ml-4 mt-0.5 space-y-0.5">
              <li>Không ai ghi thêm được sự kiện cho lô này.</li>
              <li>Mọi đối tác liên quan nhận cảnh báo ngay.</li>
              <li>Trang tra cứu công khai hiển thị "Đã thu hồi" kèm lý do.</li>
              <li>Không thể hoàn tác.</li>
            </ul>
          </div>
        </div>

        <div>
          <label htmlFor="recall-category" className={labelClass}>
            Lý do <span className="text-rose-500">*</span>
          </label>
          <select
            id="recall-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
            className={inputClass}
          >
            <option value="">— Chọn lý do —</option>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="recall-details" className={labelClass}>
            Chi tiết {category === 'Khác' ? <span className="text-rose-500">*</span> : '(khuyến khích)'}
          </label>
          <textarea
            id="recall-details"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={3}
            maxLength={800}
            placeholder="VD: Mẫu KĐ-2026-0912, chỉ tiêu Chlorpyrifos 0.08 mg/kg (ngưỡng 0.05)"
            className={`${inputClass} resize-none`}
          />
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Lý do sẽ hiển thị công khai cho người tiêu dùng.</p>
        </div>

        <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
          />
          Tôi hiểu thao tác này không thể hoàn tác.
        </label>

        {error && (
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Huỷ
          </Button>
          <Button type="submit" variant="danger" disabled={!canSubmit || busy}>
            {busy ? 'Đang thu hồi...' : 'Thu hồi lô hàng'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
