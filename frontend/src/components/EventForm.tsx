import { FormEvent, useState } from 'react'
import { SupplyChainStage, STAGE_LABELS, ROLE_STAGES, ActorRole } from '../api/client'

interface Props {
  role: ActorRole
  onSubmit: (stage: SupplyChainStage, location: string, notes: string) => Promise<void>
  disabled?: boolean
}

type ApiErr = { response?: { data?: { error?: string } } }

export default function EventForm({ role, onSubmit, disabled }: Props) {
  const [stage, setStage] = useState<SupplyChainStage | ''>('')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const allowedStages = ROLE_STAGES[role]

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!stage) return
    setError('')
    setSuccess(false)
    setLoading(true)
    try {
      await onSubmit(stage, location, notes)
      setStage('')
      setLocation('')
      setNotes('')
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError((err as ApiErr)?.response?.data?.error ?? 'Có lỗi xảy ra')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Khâu sản xuất</label>
        <select
          value={stage}
          onChange={(e) => setStage(e.target.value as SupplyChainStage)}
          required
          disabled={disabled || loading}
          aria-label="Chọn khâu sản xuất"
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm
                     focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
        >
          <option value="">— Chọn khâu —</option>
          {allowedStages.map((s) => (
            <option key={s} value={s}>{STAGE_LABELS[s]}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Địa điểm</label>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          required
          disabled={disabled || loading}
          placeholder="VD: Đà Lạt, Lâm Đồng"
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm
                     focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Ghi chú</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={disabled || loading}
          rows={2}
          placeholder="Tuỳ chọn..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm
                     focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none disabled:opacity-60"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-3 py-2">
          ✓ Ghi sự kiện thành công
        </div>
      )}

      <button
        type="submit"
        disabled={disabled || loading}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60
                   text-white font-semibold rounded-lg py-2.5 text-sm transition-colors"
      >
        {loading ? 'Đang ghi...' : 'Ghi sự kiện'}
      </button>
    </form>
  )
}
