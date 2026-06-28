import React, { useEffect, useState, FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { batchApi, eventApi, Batch, SupplyChainStage, STAGE_LABELS, ROLE_STAGES } from '../api/client'

type ApiErr = { response?: { data?: { error?: string } } }

export default function RecordEvent() {
  const { actor } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [batches, setBatches] = useState<Batch[]>([])
  const [batchId, setBatchId] = useState(searchParams.get('batchId') ?? '')
  const [stage, setStage] = useState<SupplyChainStage | ''>('')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const allowedStages = actor ? ROLE_STAGES[actor.role] : []

  useEffect(() => {
    batchApi.list()
      .then((list) => setBatches(list.filter((b) => !b.isRecalled)))
      .catch(() => {})
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!stage) return
    setError('')
    setLoading(true)
    try {
      const event = await eventApi.record({
        batchId,
        stage,
        location,
        notes: notes.trim() || undefined,
      })
      navigate(`/batch/${event.batchId}`)
    } catch (err) {
      setError((err as ApiErr)?.response?.data?.error ?? 'Ghi sự kiện thất bại')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button
          onClick={() => navigate(-1)}
          className="text-gray-500 hover:text-gray-800 text-xl leading-none"
        >
          ←
        </button>
        <h1 className="font-semibold text-gray-900">Ghi sự kiện chuỗi cung ứng</h1>
      </header>

      <main className="max-w-lg mx-auto p-4">
        {/* Actor info */}
        {actor && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 text-sm text-blue-700">
            Bạn đang đăng nhập với vai trò <strong>{actor.name}</strong>.
            Các khâu được phép: {allowedStages.map((s) => STAGE_LABELS[s]).join(', ')}.
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          {/* Batch */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Lô hàng <span className="text-red-500">*</span>
            </label>
            <select
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Chọn lô hàng —</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.productName} · {b.origin} ({b.id.slice(0, 8)}…)
                </option>
              ))}
            </select>
          </div>

          {/* Stage */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Khâu sản xuất <span className="text-red-500">*</span>
            </label>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value as SupplyChainStage)}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Chọn khâu —</option>
              {allowedStages.map((s) => (
                <option key={s} value={s}>{STAGE_LABELS[s]}</option>
              ))}
            </select>
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Địa điểm <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              required
              placeholder="VD: Đà Lạt, Lâm Đồng"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ghi chú (tuỳ chọn)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Thông tin bổ sung về lô hàng, kiểm tra chất lượng..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2.5">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60
                       text-white font-semibold rounded-lg py-2.5 text-sm transition-colors"
          >
            {loading ? 'Đang ghi...' : 'Xác nhận ghi sự kiện'}
          </button>
        </form>
      </main>
    </div>
  )
}
