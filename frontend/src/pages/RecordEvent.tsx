import { useEffect, useState, FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { batchApi, eventApi, Batch, SupplyChainStage, STAGE_LABELS, ROLE_STAGES } from '../api/client'

type ApiErr = { response?: { data?: { error?: string } } }

export default function RecordEvent() {
  const { actor } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [batches, setBatches] = useState<Batch[]>([])
  const [mode, setMode] = useState<'existing' | 'new'>(searchParams.get('batchId') ? 'existing' : 'new')
  const [batchId, setBatchId] = useState(searchParams.get('batchId') ?? '')
  const [stage, setStage] = useState<SupplyChainStage | ''>('')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // New-batch fields (only used when mode === 'new')
  const [productName, setProductName] = useState('')
  const [productType, setProductType] = useState('')
  const [origin, setOrigin] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('kg')

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
      let targetBatchId = batchId

      if (mode === 'new') {
        // Batch creation and event recording are two separate calls — if the
        // second one fails, fall through to 'existing' mode with the batch
        // that was already created, so it isn't stranded with zero events.
        const newBatch = await batchApi.create({
          productName,
          productType,
          origin,
          quantity: Number(quantity),
          unit,
        })
        targetBatchId = newBatch.id
        setBatches((prev) => [newBatch, ...prev])
        setBatchId(newBatch.id)
        setMode('existing')
      }

      const event = await eventApi.record({
        batchId: targetBatchId,
        stage,
        location,
        notes: notes.trim() || undefined,
      })
      navigate(`/batch/${event.batchId}`)
    } catch (err) {
      setError(
        (err as ApiErr)?.response?.data?.error ??
          (mode === 'new'
            ? 'Đã tạo lô hàng nhưng ghi sự kiện thất bại — thử ghi lại cho lô hàng vừa tạo.'
            : 'Ghi sự kiện thất bại'),
      )
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
          {/* Batch mode toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Lô hàng <span className="text-red-500">*</span>
            </label>
            <div className="flex rounded-lg overflow-hidden border border-gray-200 mb-3">
              <button
                type="button"
                onClick={() => setMode('existing')}
                className={`flex-1 text-sm px-3 py-2 transition-colors ${
                  mode === 'existing' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Lô hàng có sẵn
              </button>
              <button
                type="button"
                onClick={() => setMode('new')}
                className={`flex-1 text-sm px-3 py-2 transition-colors ${
                  mode === 'new' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Tạo lô hàng mới
              </button>
            </div>

            {mode === 'existing' ? (
              <select
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
                required
                aria-label="Chọn lô hàng"
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
            ) : (
              <div className="space-y-3 bg-gray-50 border border-gray-100 rounded-lg p-3">
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    required
                    placeholder="Tên sản phẩm"
                    className="col-span-2 border border-gray-300 rounded-lg px-3 py-2 text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="text"
                    value={productType}
                    onChange={(e) => setProductType(e.target.value)}
                    required
                    placeholder="Loại (VD: Nông sản)"
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="text"
                    value={origin}
                    onChange={(e) => setOrigin(e.target.value)}
                    required
                    placeholder="Xuất xứ"
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    required
                    placeholder="Số lượng"
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="text"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    required
                    placeholder="Đơn vị (VD: kg)"
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}
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
              aria-label="Chọn khâu sản xuất"
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
