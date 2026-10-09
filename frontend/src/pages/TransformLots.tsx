import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, Combine, Factory, Plus, Split, Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  actorsApi,
  Actor,
  batchApi,
  Batch,
  lineageApi,
  ROLE_LABELS,
  ROLE_STAGES,
  STAGE_LABELS,
  STAGE_ORDER,
  SupplyChainStage,
  TRANSFORMATION_LABELS,
  TransformationKind,
} from '../api/client'
import { CONVERSION_HINTS, PRODUCT_TYPES, toKg, UNITS } from '../domain/stageFields'
import { apiErrorMessage } from '../lib/apiError'
import { recallLocation, rememberLocation } from '../lib/lastLocation'
import Button from '../components/ui/Button'
import { cardClass } from '../components/ui/Card'
import { inputClass, labelClass } from '../components/ui/field'
import { SkeletonCardList } from '../components/ui/Skeleton'

const KIND_ROLES: Record<TransformationKind, Actor['role'][]> = {
  MERGE: ['PROCESSOR', 'DISTRIBUTOR', 'ADMIN'],
  SPLIT: ['PROCESSOR', 'DISTRIBUTOR', 'ADMIN'],
  TRANSFORM: ['PROCESSOR', 'ADMIN'],
}

const KIND_INFO: Record<TransformationKind, { icon: typeof Combine; hint: string }> = {
  MERGE: { icon: Combine, hint: 'Nhiều lô cùng loại vào một lô, ví dụ đại lý gom cà phê của nhiều hộ.' },
  SPLIT: { icon: Split, hint: 'Một lô chia thành nhiều lô cùng loại, ví dụ đóng nhiều container.' },
  TRANSFORM: { icon: Factory, hint: 'Đổi loại hàng, ví dụ cà phê quả tươi thành nhân xanh.' },
}

interface OutputRow {
  productName: string
  productType: string
  quantity: string
  unit: string
}

const remainingOf = (b: Batch) => Math.max(0, b.quantity - b.consumedQuantity)
const fmtQty = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 3 })

/**
 * Merge / split / transform lots (docs/SPEC_PHASE1.md §3). The server is the
 * authority on every rule; this form only guides: lots the user holds, the
 * remaining quantity of each, and a live mass-balance estimate.
 */
export default function TransformLots() {
  const { actor } = useAuth()
  const navigate = useNavigate()
  const allowedKinds = (Object.keys(KIND_ROLES) as TransformationKind[]).filter((k) => actor && KIND_ROLES[k].includes(actor.role))
  const [kind, setKind] = useState<TransformationKind>(allowedKinds[0] ?? 'MERGE')
  const [lots, setLots] = useState<Batch[] | null>(null)
  const [actors, setActors] = useState<Actor[]>([])
  const [selected, setSelected] = useState<Record<string, string>>({}) // lotId → quantity text
  const [outputs, setOutputs] = useState<OutputRow[]>([])
  const stages = actor ? ROLE_STAGES[actor.role] : []
  const [stage, setStage] = useState<SupplyChainStage>(stages[0] ?? 'PROCESSING')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [assignNextTo, setAssignNextTo] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    batchApi.custody().then(setLots).catch(() => setLots([]))
    actorsApi.list().then(setActors).catch(() => {})
  }, [])

  useEffect(() => {
    if (actor && !location) setLocation(recallLocation(actor.id, `transform-${stage}`) ?? '')
  }, [actor, stage, location])

  const chosen = useMemo(() => (lots ?? []).filter((l) => l.id in selected), [lots, selected])
  const inputType = chosen[0]?.productType

  // Keep the output rows consistent with the kind and the chosen inputs.
  useEffect(() => {
    const totalIn = chosen.reduce((s, l) => s + (Number(selected[l.id]) || 0), 0)
    const unit = chosen[0]?.unit ?? 'kg'
    if (kind === 'MERGE') {
      setOutputs([{ productName: chosen[0] ? `${chosen[0].productType} gộp` : '', productType: inputType ?? '', quantity: totalIn ? String(totalIn) : '', unit }])
    } else if (kind === 'SPLIT') {
      setOutputs((prev) =>
        prev.length >= 2 && prev.every((o) => o.productType === (inputType ?? ''))
          ? prev
          : [1, 2].map((n) => ({ productName: chosen[0] ? `${chosen[0].productName} — phần ${n}` : '', productType: inputType ?? '', quantity: '', unit })),
      )
    } else {
      const target = inputType ? Object.keys(CONVERSION_HINTS[inputType] ?? {})[0] ?? '' : ''
      setOutputs((prev) => (prev.length === 1 && prev[0].productType && prev[0].productType !== inputType ? prev : [{ productName: target, productType: target, quantity: '', unit }]))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, inputType, chosen.length, selected])

  if (actor && allowedKinds.length === 0) return <Navigate to="/tasks" replace />

  const toggle = (lot: Batch) => {
    setError('')
    setSelected((prev) => {
      if (lot.id in prev) {
        const { [lot.id]: _removed, ...rest } = prev
        return rest
      }
      const qty = String(remainingOf(lot))
      return kind === 'SPLIT' ? { [lot.id]: qty } : { ...prev, [lot.id]: qty }
    })
  }

  const usable = (lots ?? []).filter((l) => kind === 'TRANSFORM' || kind === 'SPLIT' || !inputType || l.productType === inputType)

  const inKg = chosen.reduce<number | null>((s, l) => {
    const kg = toKg(Number(selected[l.id]) || 0, l.unit)
    return s === null || kg === null ? null : s + kg
  }, 0)
  const outKg = outputs.reduce<number | null>((s, o) => {
    const kg = toKg(Number(o.quantity) || 0, o.unit)
    return s === null || kg === null ? null : s + kg
  }, 0)
  const ratio = kind === 'TRANSFORM' && inputType && outputs[0] ? CONVERSION_HINTS[inputType]?.[outputs[0].productType] : undefined
  const maxOut = inKg === null ? null : kind === 'TRANSFORM' ? (ratio ? inKg * ratio[1] : null) : inKg
  const overBalance = maxOut !== null && outKg !== null && outKg > maxOut + 1e-6

  const stageIdx = STAGE_ORDER.indexOf(stage)
  const handoffCandidates = actors.filter(
    (a) => a.isActive && a.id !== actor?.id && a.role !== 'ADMIN' && (ROLE_STAGES[a.role].includes(stage) || ROLE_STAGES[a.role].includes(STAGE_ORDER[stageIdx + 1])),
  )

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const result = await lineageApi.transform({
        kind,
        stage,
        location: location.trim(),
        notes: notes.trim() || undefined,
        inputs: chosen.map((l) => ({ lotId: l.id, quantity: Number(selected[l.id]) })),
        outputs: outputs.map((o) => ({ productName: o.productName.trim(), productType: o.productType, quantity: Number(o.quantity), unit: o.unit })),
        assignNextTo: assignNextTo || undefined,
      })
      if (actor) rememberLocation(actor.id, `transform-${stage}`, location.trim())
      const flash =
        result.anomalies.length > 0
          ? `Đã ghi nhận, nhưng có cảnh báo: ${result.anomalies[0].message}`
          : `Đã ${TRANSFORMATION_LABELS[kind].toLowerCase()} — tạo ${result.outputs.length} lô mới.`
      navigate(`/batch/${result.outputs[0].id}`, { state: { flash } })
    } catch (err) {
      setError(apiErrorMessage(err, 'Không ghi nhận được. Kiểm tra lại lô đầu vào và số lượng.'))
    } finally {
      setSubmitting(false)
    }
  }

  const minInputs = kind === 'MERGE' ? 2 : 1
  const canSubmit =
    chosen.length >= minInputs &&
    (kind !== 'SPLIT' || chosen.length === 1) &&
    outputs.length > 0 &&
    outputs.every((o) => o.productName.trim() && o.productType && Number(o.quantity) > 0) &&
    location.trim().length > 0

  return (
    <div className="page-shell">
      <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button type="button" onClick={() => navigate(-1)} aria-label="Quay lại" className="text-slate-500 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="font-semibold text-slate-900 dark:text-slate-50">Gộp / tách / chế biến lô</h1>
      </header>

      <main className="page-container">
        <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <div role="radiogroup" aria-label="Loại thao tác" className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
            {allowedKinds.map((k) => {
              const Icon = KIND_INFO[k].icon
              const active = kind === k
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setKind(k)
                    setSelected({})
                  }}
                  className={cardClass({
                    padding: 'sm',
                    className: `text-left transition-colors ${active ? '!border-brand-500 ring-2 ring-brand-100 dark:ring-brand-500/20' : 'hover:border-brand-200'}`,
                  })}
                >
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-50">
                    <Icon className="w-4 h-4 text-brand-600" /> {TRANSFORMATION_LABELS[k]}
                  </span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400 mt-1">{KIND_INFO[k].hint}</span>
                </button>
              )
            })}
          </div>

          <section className={cardClass({ className: 'space-y-3' })}>
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Lô đầu vào {kind === 'MERGE' ? '(chọn từ 2 lô cùng loại)' : kind === 'SPLIT' ? '(chọn 1 lô)' : ''}
            </h2>
            {lots === null && <SkeletonCardList rows={3} />}
            {lots?.length === 0 && <p className="text-sm text-slate-500">Bạn chưa giữ lô hàng nào có thể dùng.</p>}
            <ul className="space-y-2 max-h-[60vh] overflow-y-auto">
              {usable.map((l) => {
                const checked = l.id in selected
                return (
                  <li key={l.id} className={`rounded-xl border p-3 ${checked ? 'border-brand-300 bg-brand-50/50 dark:bg-brand-500/10 dark:border-brand-500/40' : 'border-slate-200 dark:border-slate-700'}`}>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input type={kind === 'SPLIT' ? 'radio' : 'checkbox'} name="input-lot" checked={checked} onChange={() => toggle(l)} className="mt-1" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-slate-900 dark:text-slate-50 truncate">{l.productName}</span>
                        <span className="block text-xs text-slate-500">
                          {l.productType} · {l.origin} · còn {fmtQty(remainingOf(l))}/{fmtQty(l.quantity)} {l.unit}
                          {l.currentStage && ` · ${STAGE_LABELS[l.currentStage]}`}
                        </span>
                      </span>
                    </label>
                    {checked && (
                      <div className="mt-2 flex items-center gap-2 pl-7">
                        <label htmlFor={`q-${l.id}`} className="text-xs text-slate-500">Lấy</label>
                        <input
                          id={`q-${l.id}`}
                          type="number"
                          min="0.001"
                          step="any"
                          max={remainingOf(l)}
                          value={selected[l.id]}
                          onChange={(e) => setSelected((p) => ({ ...p, [l.id]: e.target.value }))}
                          className={`${inputClass} !w-32 !py-1.5`}
                        />
                        <span className="text-xs text-slate-500">{l.unit}</span>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>

          <div className="space-y-4 min-w-0">
          <section className={cardClass({ className: 'space-y-3' })}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Lô đầu ra</h2>
              {kind === 'SPLIT' && (
                <button
                  type="button"
                  onClick={() => setOutputs((o) => [...o, { ...o[0], productName: `${chosen[0]?.productName ?? 'Lô'} — phần ${o.length + 1}`, quantity: '' }])}
                  className="text-xs text-brand-600 font-medium inline-flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Thêm phần
                </button>
              )}
            </div>
            {outputs.map((o, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-12 sm:col-span-5">
                  <label className={labelClass} htmlFor={`out-name-${i}`}>Tên lô</label>
                  <input id={`out-name-${i}`} value={o.productName} onChange={(e) => setOutputs((p) => p.map((x, j) => (j === i ? { ...x, productName: e.target.value } : x)))} className={inputClass} required />
                </div>
                <div className="col-span-6 sm:col-span-3">
                  <label className={labelClass} htmlFor={`out-type-${i}`}>Loại hàng</label>
                  <select
                    id={`out-type-${i}`}
                    value={o.productType}
                    disabled={kind !== 'TRANSFORM'}
                    onChange={(e) => setOutputs((p) => p.map((x, j) => (j === i ? { ...x, productType: e.target.value } : x)))}
                    className={inputClass}
                  >
                    <option value="">—</option>
                    {[...new Set([o.productType, ...PRODUCT_TYPES].filter(Boolean))].map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <label className={labelClass} htmlFor={`out-q-${i}`}>Số lượng</label>
                  <input id={`out-q-${i}`} type="number" min="0.001" step="any" value={o.quantity} onChange={(e) => setOutputs((p) => p.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} className={inputClass} required />
                </div>
                <div className="col-span-2 sm:col-span-2 flex gap-1">
                  <select aria-label="Đơn vị" value={o.unit} onChange={(e) => setOutputs((p) => p.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} className={inputClass}>
                    {UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                  </select>
                  {kind === 'SPLIT' && outputs.length > 2 && (
                    <button type="button" aria-label="Xoá phần này" onClick={() => setOutputs((p) => p.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-600 px-1">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {inKg !== null && outKg !== null && chosen.length > 0 && (
              <p className={`text-xs ${overBalance ? 'text-rose-600 dark:text-rose-400 font-medium' : 'text-slate-500'}`}>
                Đầu vào {fmtQty(inKg)} kg → đầu ra {fmtQty(outKg)} kg
                {kind === 'TRANSFORM' && ratio && ` (tỉ lệ cho phép ${ratio[0]}–${ratio[1]}, tối đa ${fmtQty(inKg * ratio[1])} kg)`}
                {overBalance && ' — vượt mức cân bằng khối lượng, sẽ bị gắn cảnh báo.'}
              </p>
            )}
            {kind === 'TRANSFORM' && inputType && outputs[0]?.productType && !ratio && (
              <p className="text-xs text-slate-500">Chưa có hệ số quy đổi cho {inputType} → {outputs[0].productType}: không kiểm cân bằng khối lượng.</p>
            )}
          </section>

          <section className={cardClass({ className: 'grid grid-cols-1 sm:grid-cols-2 gap-3' })}>
            <div>
              <label className={labelClass} htmlFor="stage">Khâu</label>
              <select id="stage" value={stage} onChange={(e) => setStage(e.target.value as SupplyChainStage)} className={inputClass}>
                {stages.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="location">Địa điểm</label>
              <input id="location" value={location} onChange={(e) => setLocation(e.target.value)} required maxLength={200} className={inputClass} placeholder="VD: Nhà máy Bảo Lộc" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="handoff">Lô đầu ra giao cho</label>
              <select id="handoff" value={assignNextTo} onChange={(e) => setAssignNextTo(e.target.value)} className={inputClass}>
                <option value="">Tôi giữ lại để xử lý tiếp</option>
                {handoffCandidates.map((a) => (
                  <option key={a.id} value={a.id}>{a.organization} · {a.name} ({ROLE_LABELS[a.role]})</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="notes">Ghi chú</label>
              <textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} className={`${inputClass} resize-none`} placeholder="Chỉ nội bộ" />
            </div>
          </section>

          </div>

          {error && (
            <div role="alert" className="lg:col-span-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-sm rounded-xl px-3.5 py-2.5">
              {error}
            </div>
          )}
          <div className="lg:col-span-2 flex justify-end">
            <Button type="submit" disabled={submitting || !canSubmit} className="w-full lg:w-auto lg:min-w-64">
              {submitting ? 'Đang ghi nhận...' : `Ghi nhận ${TRANSFORMATION_LABELS[kind].toLowerCase()}`}
            </Button>
          </div>
        </form>
      </main>
    </div>
  )
}
