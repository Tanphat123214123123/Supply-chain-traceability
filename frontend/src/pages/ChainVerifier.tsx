import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import BackButton from '../components/BackButton'
import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  ExternalLink,
  EyeOff,
  Link2,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldQuestion,
  XCircle,
} from 'lucide-react'
import { traceApi, STAGE_LABELS, SupplyChainStage } from '../api/client'
import { formatFieldValue, STAGE_FIELDS } from '../domain/stageFields'
import { anchorChainConfig, createAnchorReader } from '../lib/verify/chain'
import { BatchVerdict, EventVerdict, verifyBatch, VerificationPayload } from '../lib/verify/verifyBatch'
import Button from '../components/ui/Button'
import { inputClass } from '../components/ui/field'
import { cardClass } from '../components/ui/Card'

type ApiErr = { response?: { status?: number } }

const FIELD_LABELS: Record<string, string> = { location: 'Địa điểm', actorId: 'Người thực hiện (mã)', notes: 'Ghi chú' }

function fieldLabel(stage: string, name: string): string {
  if (FIELD_LABELS[name]) return FIELD_LABELS[name]
  const key = name.replace(/^data\./, '')
  return STAGE_FIELDS[stage as SupplyChainStage]?.find((f) => f.key === key)?.label ?? key
}

function fieldValue(stage: string, name: string, value: unknown): string {
  if (!name.startsWith('data.')) return String(value)
  return formatFieldValue(stage as SupplyChainStage, name.slice(5), value) || String(value)
}

const fmt = (d: Date | string) =>
  new Date(d).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function Chip({ tone, children }: { tone: 'ok' | 'bad' | 'wait' | 'muted'; children: React.ReactNode }) {
  const tones = {
    ok: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
    bad: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400',
    wait: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
    muted: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  }
  return <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${tones[tone]}`}>{children}</span>
}

function EventCard({ v, raw, explorerUrl }: { v: EventVerdict; raw: VerificationPayload['events'][number]; explorerUrl?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            {v.sequenceNumber + 1}. {STAGE_LABELS[v.stage as SupplyChainStage] ?? v.stage}
            {raw.kind !== 'OBSERVE' && (
              <span className="ml-2 text-xs font-normal text-slate-500">
                ({raw.kind === 'MERGE' ? 'gộp' : raw.kind === 'SPLIT' ? 'tách' : 'biến đổi'} từ {raw.links.length} lô)
              </span>
            )}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{fmt(raw.timestamp)}</p>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {v.content === 'ok' && <Chip tone="ok"><CheckCircle2 className="w-3 h-3" /> Nội dung khớp</Chip>}
          {v.content === 'mismatch' && <Chip tone="bad"><XCircle className="w-3 h-3" /> Nội dung sai lệch</Chip>}
          {v.content === 'opaque' && <Chip tone="muted"><EyeOff className="w-3 h-3" /> Nội dung không công khai</Chip>}
          {!v.linked && <Chip tone="bad"><XCircle className="w-3 h-3" /> Đứt chuỗi</Chip>}
          {v.anchor === 'anchored' && <Chip tone="ok"><ShieldCheck className="w-3 h-3" /> Đã neo</Chip>}
          {v.anchor === 'pending' && <Chip tone="wait"><CircleDashed className="w-3 h-3" /> Chờ neo</Chip>}
          {v.anchor === 'mismatch' && <Chip tone="bad"><XCircle className="w-3 h-3" /> Neo sai lệch</Chip>}
          {v.anchor === 'unchecked' && <Chip tone="muted"><ShieldQuestion className="w-3 h-3" /> Chưa đối chiếu</Chip>}
        </div>
      </div>

      {v.fields.length > 0 && (
        <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
          {v.fields.map((f) => (
            <div key={f.name} className="text-sm">
              <dt className="inline text-slate-500 dark:text-slate-400">{fieldLabel(v.stage, f.name)}: </dt>
              <dd className="inline text-slate-800 dark:text-slate-100">{fieldValue(v.stage, f.name, f.value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {v.hiddenFieldCount > 0 && (
        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
          + {v.hiddenFieldCount} trường nội bộ được ẩn — vẫn được kiểm qua mã cam kết.
        </p>
      )}
      {v.anchor === 'anchored' && v.anchoredAt && (
        <p className="mt-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          Đóng dấu trên blockchain lúc {fmt(v.anchoredAt)} · khối #{v.blockNumber}
          {explorerUrl && v.txHash && (
            <a href={`${explorerUrl}/tx/${v.txHash}`} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-0.5 underline">
              xem giao dịch <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </p>
      )}

      <button type="button" onClick={() => setOpen((o) => !o)} className="mt-2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 inline-flex items-center gap-1">
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} /> Chi tiết kỹ thuật
      </button>
      {open && (
        <div className="mt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 break-all space-y-0.5">
          <p>hash v{raw.hashVersion}: {raw.hash}</p>
          <p>prevHash: {raw.prevHash}</p>
          {raw.anchor && (
            <>
              <p>merkle root: {raw.anchor.anchor.root}</p>
              <p>
                lá #{raw.anchor.leafIndex}/{raw.anchor.anchor.leafCount} · {raw.anchor.proof.length} nút bằng chứng
              </p>
              {raw.anchor.anchor.txHash && <p>tx: {raw.anchor.anchor.txHash}</p>}
            </>
          )}
          {raw.links.map((l) => (
            <p key={l.lotId}>
              đầu vào: lô {l.lotId.slice(0, 8)} · {l.quantity} {l.unit} · head {l.headHash.slice(0, 16)}…
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ChainVerifier() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? undefined
  const [batchId, setBatchId] = useState(searchParams.get('batch') ?? '')
  const [payload, setPayload] = useState<VerificationPayload | null>(null)
  const [verdict, setVerdict] = useState<BatchVerdict | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(false)

  const chainConfig = useMemo(() => anchorChainConfig(), [])
  const reader = useMemo(() => (chainConfig ? createAnchorReader(chainConfig) : null), [chainConfig])

  /** Everything here runs in this browser: hashes, proofs, and the contract read over RPC. */
  const check = useCallback(
    async (p: VerificationPayload) => {
      setChecking(true)
      try {
        setVerdict(
          await verifyBatch(p, { reader, trustedContract: chainConfig?.contractAddress, trustedChainId: chainConfig?.chainId }),
        )
      } finally {
        setChecking(false)
      }
    },
    [reader, chainConfig],
  )

  const load = useCallback(
    async (id: string) => {
      setError('')
      setPayload(null)
      setVerdict(null)
      setLoading(true)
      try {
        const p = await traceApi.verifyFull(id.trim(), token)
        setPayload(p)
        await check(p)
      } catch (err) {
        const status = (err as ApiErr)?.response?.status
        setError(
          status === 404 || !status
            ? 'Không tìm thấy lô hàng'
            : status === 403
              ? 'Link kiểm chứng không hợp lệ hoặc đã hết hạn'
              : 'Không tải được dữ liệu, thử lại sau',
        )
      } finally {
        setLoading(false)
      }
    },
    [token, check],
  )

  useEffect(() => {
    const fromLink = searchParams.get('batch')
    if (fromLink) load(fromLink)
  }, [searchParams, load])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    load(batchId)
  }

  const overall = verdict?.overall
  const anchoredCount = verdict?.events.filter((e) => e.anchor === 'anchored').length ?? 0

  return (
    <div className="page-shell p-4">
      <div className="max-w-6xl mx-auto py-8 space-y-4">
        <BackButton fallback={searchParams.get('batch') ? `/provenance/${searchParams.get('batch')}` : '/'} className="-ml-3 -mt-4" />
        <div className="text-center animate-slide-up">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-brand-500 to-emerald-500 flex items-center justify-center text-white mb-4 shadow-glow">
            <Search className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">Xác minh độc lập</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-md mx-auto">
            Trình duyệt của bạn tự tính lại mã băm và tự đối chiếu với blockchain công khai — không cần tin máy chủ TraceChain.
          </p>
        </div>

        <form onSubmit={handleSubmit} className={cardClass({ className: 'flex gap-2' })}>
          <input
            type="text"
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            placeholder="Nhập mã lô hàng..."
            aria-label="Mã lô hàng"
            required
            className={`${inputClass} font-mono`}
          />
          <Button type="submit" disabled={loading}>
            {loading ? 'Đang tải...' : 'Xác minh'}
          </Button>
        </form>

        {error && (
          <div role="alert" className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 text-sm rounded-xl px-3 py-2.5 text-center">
            {error}
          </div>
        )}

        {payload && verdict && (
          <div className="space-y-3 animate-slide-up">
            <div
              data-testid="verdict"
              data-verdict={overall}
              className={`rounded-2xl p-5 border ${
                overall === 'verified'
                  ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/20'
                  : overall === 'failed'
                    ? 'bg-rose-50 border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/20'
                    : 'bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20'
              }`}
            >
              <p
                className={`font-semibold flex items-center gap-1.5 ${
                  overall === 'verified' ? 'text-emerald-700 dark:text-emerald-400' : overall === 'failed' ? 'text-rose-700 dark:text-rose-400' : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                {overall === 'verified' && <><ShieldCheck className="w-5 h-5" /> Đã xác minh trên blockchain</>}
                {overall === 'partially-verified' && <><ShieldQuestion className="w-5 h-5" /> Chưa phát hiện sai lệch — một phần chưa được đóng dấu</>}
                {overall === 'failed' && <><XCircle className="w-5 h-5" /> Phát hiện sai lệch</>}
              </p>
              <p className="text-sm text-slate-700 dark:text-slate-300 mt-1">
                {payload.batch.productName} · {payload.events.length} sự kiện · {anchoredCount} đã neo trên blockchain
              </p>
              {verdict.problems.length > 0 && (
                <ul className="mt-2 text-sm list-disc pl-5 text-slate-700 dark:text-slate-300">
                  {verdict.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Xác minh chứng minh dữ liệu <strong>chưa bị sửa hoặc xoá</strong> kể từ khi được đóng dấu — không thay thế kiểm định chất lượng.
              </p>
            </div>

            <div className={cardClass({ padding: 'sm', className: 'text-xs text-slate-600 dark:text-slate-400 space-y-1' })}>
              {chainConfig ? (
                <p className="flex items-start gap-1.5">
                  <Link2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>
                    Hợp đồng <span className="font-mono break-all">{chainConfig.contractAddress}</span> trên chuỗi #{chainConfig.chainId}, đọc trực
                    tiếp qua RPC công khai. So sánh địa chỉ này với địa chỉ TraceChain công bố.
                  </span>
                </p>
              ) : (
                <p>Bản dựng này chưa cấu hình blockchain — chỉ kiểm tra được mã băm, chưa đối chiếu được dấu thời gian.</p>
              )}
              <p>
                {payload.access === 'full'
                  ? `Link kiểm chứng đầy đủ — mọi trường được mở${payload.expiresAt ? `, hiệu lực đến ${fmt(payload.expiresAt)}` : ''}.`
                  : 'Bản công khai — chỉ các trường công bố được hiển thị; trường nội bộ chỉ có mã cam kết.'}
              </p>
              <button
                type="button"
                onClick={() => check(payload)}
                disabled={checking}
                className="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400 font-medium hover:underline disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} /> Kiểm tra lại (không tải lại dữ liệu từ máy chủ)
              </button>
            </div>

            <div className={cardClass({ padding: 'none', className: 'divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden' })}>
              {verdict.events.map((v, i) => (
                <EventCard key={v.id} v={v} raw={payload.events[i]} explorerUrl={chainConfig?.explorerUrl} />
              ))}
            </div>

            <p className="text-center">
              <Link to={`/provenance/${payload.batch.id}`} className="text-sm text-brand-600 dark:text-brand-400 hover:underline font-medium">
                Xem trang tra cứu công khai →
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
