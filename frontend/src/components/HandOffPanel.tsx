import { useState } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import { Actor, Batch, batchApi, STAGE_LABELS } from '../api/client'
import { nextStageOf } from '../domain/stageFields'
import { apiErrorMessage } from '../lib/apiError'
import HandoffSelect from './HandoffSelect'
import Button from './ui/Button'
import { cardClass } from './ui/Card'

/**
 * Passing a lot on without recording a stage — e.g. the mill kept the green
 * beans after transforming them and now sends them to QC. Shown only to the
 * custodian when the next stage belongs to someone else.
 */
export default function HandOffPanel({ batch, actors, onDone }: { batch: Batch; actors: Actor[]; onDone: (b: Batch) => void }) {
  const next = nextStageOf(batch)
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!next) return null

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      onDone(await batchApi.handOff(batch.id, to))
    } catch (err) {
      setError(apiErrorMessage(err, 'Không bàn giao được.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={cardClass({ className: 'space-y-3 border-amber-200/80 dark:border-amber-500/20' })}>
      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
        <ArrowRightLeft className="w-4 h-4 text-amber-500" /> Bàn giao lô
      </h2>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Bạn đang giữ lô này, nhưng khâu tiếp theo ({STAGE_LABELS[next].toLowerCase()}) do đơn vị khác thực hiện.
      </p>
      <HandoffSelect nextStage={next} actors={actors} value={to} onChange={setTo} isAdmin={false} />
      {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
      <Button type="button" onClick={submit} disabled={busy || !to} size="sm">
        {busy ? 'Đang bàn giao...' : 'Bàn giao'}
      </Button>
    </section>
  )
}
