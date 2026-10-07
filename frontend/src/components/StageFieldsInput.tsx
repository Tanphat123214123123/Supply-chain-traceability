import { Globe } from 'lucide-react'
import { SupplyChainStage } from '../api/client'
import { STAGE_FIELDS, StageField } from '../domain/stageFields'
import { inputClass, labelClass } from './ui/field'

export type StageValues = Record<string, string>

/** Form values (all strings) → the `data` payload: numbers parsed, blanks dropped. */
export function toEventData(stage: SupplyChainStage, values: StageValues): Record<string, string | number> {
  const data: Record<string, string | number> = {}
  for (const field of STAGE_FIELDS[stage]) {
    const raw = values[field.key]?.trim()
    if (!raw) continue
    data[field.key] = field.type === 'number' ? Number(raw) : raw
  }
  return data
}

function FieldInput({
  field,
  id,
  value,
  onChange,
}: {
  field: StageField
  id: string
  value: string
  onChange: (v: string) => void
}) {
  if (field.type === 'select') {
    return (
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} required={field.required} className={inputClass}>
        <option value="">— Chọn —</option>
        {field.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }
  const input = (
    <input
      id={id}
      type={field.type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={field.required}
      placeholder={field.placeholder}
      min={field.min}
      max={field.max}
      step={field.type === 'number' ? 'any' : undefined}
      inputMode={field.type === 'number' ? 'decimal' : undefined}
      className={`${inputClass} ${field.unit && !field.unit.startsWith('theo') ? 'pr-12' : ''}`}
    />
  )
  if (!field.unit || field.unit.startsWith('theo')) return input
  return (
    <div className="relative">
      {input}
      <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">{field.unit}</span>
    </div>
  )
}

/** The structured facts a stage records — rendered from STAGE_FIELDS so every stage has its own form. */
export default function StageFieldsInput({
  stage,
  values,
  onChange,
  unitHint,
}: {
  stage: SupplyChainStage
  values: StageValues
  onChange: (next: StageValues) => void
  /** The batch's unit, shown for "theo đơn vị lô" quantities. */
  unitHint?: string
}) {
  const fields = STAGE_FIELDS[stage]
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-4">
      {fields.map((field) => {
        const id = `stage-field-${field.key}`
        return (
          <div key={field.key} className={field.type === 'text' && !field.unit ? 'sm:col-span-2' : ''}>
            <label htmlFor={id} className={`${labelClass} flex items-center gap-1.5`}>
              {field.label}
              {field.unit?.startsWith('theo') && unitHint && <span className="font-normal text-slate-400">({unitHint})</span>}
              {field.required && <span className="text-rose-500">*</span>}
              {field.public && (
                <span title="Hiển thị trên trang tra cứu công khai" className="text-slate-400 dark:text-slate-500">
                  <Globe className="w-3.5 h-3.5" aria-label="Công khai" />
                </span>
              )}
            </label>
            <FieldInput field={field} id={id} value={values[field.key] ?? ''} onChange={(v) => onChange({ ...values, [field.key]: v })} />
          </div>
        )
      })}
    </div>
  )
}
