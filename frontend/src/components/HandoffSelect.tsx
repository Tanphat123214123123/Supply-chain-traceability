import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Actor, ROLE_LABELS, STAGE_LABELS, SupplyChainStage } from '../api/client'
import { rolesForStage } from '../domain/stageFields'
import { inputClass, labelClass } from './ui/field'

/**
 * "Who takes the batch next" — only active accounts whose role handles the
 * following stage are offered, and a single candidate is pre-selected so the
 * common case is zero clicks.
 */
export default function HandoffSelect({
  nextStage,
  actors,
  value,
  onChange,
  isAdmin,
}: {
  nextStage: SupplyChainStage
  actors: Actor[]
  value: string
  onChange: (id: string) => void
  isAdmin: boolean
}) {
  const roles = rolesForStage(nextStage)
  const candidates = actors.filter((a) => a.isActive && roles.includes(a.role))

  useEffect(() => {
    if (!value && candidates.length === 1) onChange(candidates[0].id)
  }, [value, candidates, onChange])

  return (
    <div>
      <label htmlFor="handoff" className={labelClass}>
        Bàn giao cho ({STAGE_LABELS[nextStage].toLowerCase()}) {!isAdmin && <span className="text-rose-500">*</span>}
      </label>
      <select
        id="handoff"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={!isAdmin}
        className={inputClass}
      >
        <option value="">{isAdmin ? '— Để trống (chưa giao cho ai) —' : '— Chọn người tiếp nhận —'}</option>
        {candidates.map((a) => (
          <option key={a.id} value={a.id}>
            {a.organization} · {a.name}
          </option>
        ))}
      </select>
      {candidates.length === 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
          Chưa có {roles.map((r) => ROLE_LABELS[r].toLowerCase()).join(' hoặc ')} nào trong không gian làm việc.{' '}
          {isAdmin ? (
            <Link to="/actors" className="underline font-medium">
              Mời thành viên
            </Link>
          ) : (
            'Nhờ quản trị viên gửi lời mời cho đối tác.'
          )}
        </p>
      )}
    </div>
  )
}
