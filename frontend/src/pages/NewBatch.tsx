import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, Sprout } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { actorsApi, Actor, batchApi, Batch, eventApi } from '../api/client'
import { PRODUCT_TYPES, UNITS } from '../domain/stageFields'
import { apiErrorMessage } from '../lib/apiError'
import StageFieldsInput, { StageValues, toEventData } from '../components/StageFieldsInput'
import HandoffSelect from '../components/HandoffSelect'
import Button from '../components/ui/Button'
import { inputClass, labelClass } from '../components/ui/field'
import { cardClass } from '../components/ui/Card'

/**
 * Creating a batch IS its harvest: one form, one place name (the farm — no
 * separate "origin" vs "location"), product type and unit picked from fixed
 * lists so reports group cleanly, then handed straight to a processor.
 */
export default function NewBatch() {
  const { actor } = useAuth()
  const navigate = useNavigate()
  const [actors, setActors] = useState<Actor[]>([])

  const [productName, setProductName] = useState('')
  const [productType, setProductType] = useState('')
  const [origin, setOrigin] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('kg')
  const [harvest, setHarvest] = useState<StageValues>({ harvestDate: new Date().toISOString().slice(0, 10) })
  const [notes, setNotes] = useState('')
  const [assignNextTo, setAssignNextTo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  // Set once the batch exists, so a retry after a failed harvest record doesn't create a second batch.
  const [created, setCreated] = useState<Batch | null>(null)

  const isAdmin = actor?.role === 'ADMIN'
  const onHandoffChange = useCallback((id: string) => setAssignNextTo(id), [])

  useEffect(() => {
    actorsApi.list().then(setActors).catch(() => {})
  }, [])

  if (actor && actor.role !== 'FARMER' && !isAdmin) return <Navigate to="/tasks" replace />

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const batch =
        created ??
        (await batchApi.create({
          productName: productName.trim(),
          productType,
          origin: origin.trim(),
          quantity: Number(quantity),
          unit,
        }))
      setCreated(batch)
      await eventApi.record({
        batchId: batch.id,
        stage: 'HARVEST',
        location: batch.origin,
        notes: notes.trim() || undefined,
        data: toEventData('HARVEST', harvest),
        assignNextTo: assignNextTo || undefined,
      })
      navigate(`/batch/${batch.id}`, { state: { flash: 'Đã tạo lô hàng và ghi nhận thu hoạch.' } })
    } catch (err) {
      setError(
        created
          ? apiErrorMessage(err, 'Lô hàng đã được tạo nhưng chưa ghi được thu hoạch. Bấm lưu lại để thử tiếp.')
          : apiErrorMessage(err, 'Không tạo được lô hàng. Thử lại sau.'),
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page-shell">
      <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Quay lại"
          className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="font-semibold text-slate-900 dark:text-slate-50">Lô hàng mới</h1>
      </header>

      <main className="max-w-lg mx-auto p-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <fieldset disabled={!!created} className={cardClass({ padding: 'lg', className: 'space-y-4 disabled:opacity-70' })}>
            <legend className="sr-only">Thông tin sản phẩm</legend>
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Sản phẩm</h2>
            <div>
              <label htmlFor="productName" className={labelClass}>
                Tên sản phẩm <span className="text-rose-500">*</span>
              </label>
              <input
                id="productName"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                required
                maxLength={200}
                placeholder="VD: Cà phê Robusta Cầu Đất"
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 sm:col-span-1">
                <label htmlFor="productType" className={labelClass}>
                  Loại <span className="text-rose-500">*</span>
                </label>
                <select id="productType" value={productType} onChange={(e) => setProductType(e.target.value)} required className={inputClass}>
                  <option value="">— Chọn loại —</option>
                  {PRODUCT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label htmlFor="quantity" className={labelClass}>
                  Số lượng <span className="text-rose-500">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    id="quantity"
                    type="number"
                    min="0.001"
                    step="any"
                    inputMode="decimal"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    required
                    className={`${inputClass} min-w-0`}
                  />
                  <select aria-label="Đơn vị" value={unit} onChange={(e) => setUnit(e.target.value)} className={`${inputClass} w-24`}>
                    {UNITS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div>
              <label htmlFor="origin" className={labelClass}>
                Vùng trồng / nông trại <span className="text-rose-500">*</span>
              </label>
              <input
                id="origin"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                required
                maxLength={200}
                placeholder="VD: Cầu Đất, Đà Lạt, Lâm Đồng"
                className={inputClass}
              />
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Dùng làm xuất xứ của lô và địa điểm thu hoạch.</p>
            </div>
          </fieldset>

          <div className={cardClass({ padding: 'lg', className: 'space-y-4' })}>
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
              <Sprout className="w-4 h-4 text-emerald-500" /> Thu hoạch
            </h2>
            <StageFieldsInput stage="HARVEST" values={harvest} onChange={setHarvest} />
            <div>
              <label htmlFor="notes" className={labelClass}>
                Ghi chú
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="Chỉ nội bộ — không hiển thị cho người tiêu dùng"
                className={`${inputClass} resize-none`}
              />
            </div>
            <HandoffSelect nextStage="PROCESSING" actors={actors} value={assignNextTo} onChange={onHandoffChange} isAdmin={isAdmin} />
          </div>

          {error && (
            <div role="alert" className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-sm rounded-xl px-3.5 py-2.5">
              {error}
            </div>
          )}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? 'Đang lưu...' : created ? 'Lưu lại thu hoạch' : 'Tạo lô & bàn giao'}
          </Button>
        </form>
      </main>
    </div>
  )
}
