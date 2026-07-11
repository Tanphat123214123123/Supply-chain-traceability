import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CircleX, ShieldCheck, TriangleAlert, Siren, CircleCheck } from 'lucide-react'
import { traceApi, PublicTrace, STAGE_LABELS, STAGE_ORDER, STAGE_ICONS } from '../api/client'

export default function Provenance() {
  const { batchId } = useParams<{ batchId: string }>()
  const [data, setData] = useState<PublicTrace | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!batchId) return
    traceApi.public(batchId)
      .then(setData)
      .catch(() => setError('Không tìm thấy lô hàng'))
      .finally(() => setLoading(false))
  }, [batchId])

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-brand-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 flex items-center justify-center">
        <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 text-sm">
          <span className="w-4 h-4 rounded-full border-2 border-slate-200 dark:border-slate-700 border-t-brand-500 dark:border-t-brand-400 animate-spin" />
          Đang tra cứu nguồn gốc...
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
        <div className="text-center">
          <CircleX className="w-12 h-12 mx-auto mb-3 text-rose-500 dark:text-rose-400" />
          <p className="text-rose-500 dark:text-rose-400 font-medium">{error || 'Không tìm thấy lô hàng'}</p>
          <p className="text-slate-400 dark:text-slate-500 text-sm mt-2">Mã lô hàng: {batchId}</p>
        </div>
      </div>
    )
  }

  const currentIdx = data.batch.currentStage
    ? STAGE_ORDER.indexOf(data.batch.currentStage)
    : -1

  const isRecalled = data.batch.isRecalled

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-brand-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 p-4">
      <div className="max-w-sm mx-auto pt-8 pb-12">
        {/* Header */}
        <div className="text-center mb-6 animate-slide-up">
          <div className="flex justify-center mb-3">
            {isRecalled
              ? <Siren className="w-14 h-14 text-rose-500 dark:text-rose-400" />
              : <CircleCheck className="w-14 h-14 text-emerald-500 dark:text-emerald-400" />}
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">{data.batch.productName}</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{data.batch.productType}</p>
        </div>

        {/* Chain validity */}
        <div className={`rounded-2xl p-4 mb-4 text-center shadow-card dark:shadow-none animate-slide-up [animation-delay:80ms] ${
          data.isValid
            ? 'bg-emerald-50 border border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/20'
            : 'bg-rose-50 border border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/20'
        }`}>
          <p className={`text-sm font-semibold flex items-center justify-center gap-1.5 ${data.isValid ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
            {data.isValid
              ? <><ShieldCheck className="w-4 h-4" /> Dữ liệu hợp lệ — Không bị can thiệp</>
              : <><TriangleAlert className="w-4 h-4" /> Dữ liệu có dấu hiệu bất thường</>}
          </p>
          {data.hasAnomalies && data.isValid && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Phát hiện một số bất thường trong quá trình</p>
          )}
        </div>

        {/* Recall banner */}
        {isRecalled && (
          <div className="bg-rose-50 border-2 border-rose-300 dark:bg-rose-500/10 dark:border-rose-500/30 rounded-2xl p-4 mb-4 shadow-card dark:shadow-none animate-slide-up [animation-delay:120ms]">
            <p className="font-bold text-rose-700 dark:text-rose-400 text-center flex items-center justify-center gap-1.5">
              <TriangleAlert className="w-4 h-4" /> LÔ HÀNG ĐÃ BỊ THU HỒI
            </p>
            {data.batch.recallReason && (
              <p className="text-rose-600 dark:text-rose-400/90 text-sm text-center mt-1">{data.batch.recallReason}</p>
            )}
          </div>
        )}

        {/* Product details */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-card dark:shadow-none p-4 mb-4 space-y-3 animate-slide-up [animation-delay:160ms]">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Thông tin sản phẩm</h2>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 dark:text-slate-400">Xuất xứ</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">{data.batch.origin}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 dark:text-slate-400">Khâu hiện tại</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {data.batch.currentStage
                  ? STAGE_LABELS[data.batch.currentStage]
                  : 'Chưa bắt đầu'}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 dark:text-slate-400">Số khâu hoàn thành</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {data.stageCount} / {STAGE_ORDER.length}
              </span>
            </div>
          </div>
        </div>

        {/* Journey progress */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-card dark:shadow-none p-4 mb-4 animate-slide-up [animation-delay:200ms]">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">Hành trình sản phẩm</h2>
          <div className="space-y-3">
            {STAGE_ORDER.map((stage, i) => {
              const done = i <= currentIdx
              const current = i === currentIdx
              const StageIcon = STAGE_ICONS[stage]
              return (
                <div key={stage} className="flex items-center gap-3">
                  <div className={`
                    w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 transition-all
                    ${done
                      ? current
                        ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white ring-4 ring-brand-100 dark:ring-brand-500/20'
                        : 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'}
                  `}>
                    {done ? (current ? <StageIcon className="w-4 h-4" /> : <CircleCheck className="w-4 h-4" />) : i + 1}
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm ${done ? 'text-slate-900 dark:text-slate-100 font-medium' : 'text-slate-400 dark:text-slate-500'}`}>
                      {STAGE_LABELS[stage]}
                    </p>
                  </div>
                  {current && (
                    <span className="text-xs bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400 px-2 py-0.5 rounded-full font-medium">
                      Hiện tại
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center animate-fade-in">
          <p className="text-xs text-slate-400 dark:text-slate-500 font-mono break-all">ID: {batchId}</p>
          <p className="text-xs text-slate-300 dark:text-slate-600 mt-1">Powered by TraceChain · Chuỗi hash minh bạch, kiểm chứng được</p>
        </div>
      </div>
    </div>
  )
}
