import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
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
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Đang tra cứu nguồn gốc...</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-5xl mb-3">❌</div>
          <p className="text-red-500 font-medium">{error || 'Không tìm thấy lô hàng'}</p>
          <p className="text-gray-400 text-sm mt-2">Mã lô hàng: {batchId}</p>
        </div>
      </div>
    )
  }

  const currentIdx = data.batch.currentStage
    ? STAGE_ORDER.indexOf(data.batch.currentStage)
    : -1

  const isRecalled = data.batch.isRecalled

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 p-4">
      <div className="max-w-sm mx-auto pt-6 pb-12">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-6xl mb-3">{isRecalled ? '🚨' : '✅'}</div>
          <h1 className="text-2xl font-bold text-gray-900">{data.batch.productName}</h1>
          <p className="text-gray-500 text-sm mt-1">{data.batch.productType}</p>
        </div>

        {/* Chain validity */}
        <div className={`rounded-2xl p-4 mb-4 text-center ${
          data.isValid
            ? 'bg-green-100 border border-green-200'
            : 'bg-red-100 border border-red-200'
        }`}>
          <p className={`text-sm font-semibold ${data.isValid ? 'text-green-700' : 'text-red-700'}`}>
            {data.isValid
              ? '🛡 Dữ liệu hợp lệ — Không bị can thiệp'
              : '⚠ Dữ liệu có dấu hiệu bất thường'}
          </p>
          {data.hasAnomalies && data.isValid && (
            <p className="text-xs text-amber-600 mt-1">Phát hiện một số bất thường trong quá trình</p>
          )}
        </div>

        {/* Recall banner */}
        {isRecalled && (
          <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-4 mb-4">
            <p className="font-bold text-red-700 text-center">⚠ LÔ HÀNG ĐÃ BỊ THU HỒI</p>
            {data.batch.recallReason && (
              <p className="text-red-600 text-sm text-center mt-1">{data.batch.recallReason}</p>
            )}
          </div>
        )}

        {/* Product details */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Thông tin sản phẩm</h2>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Xuất xứ</span>
              <span className="font-medium text-gray-900">{data.batch.origin}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Khâu hiện tại</span>
              <span className="font-medium text-gray-900">
                {data.batch.currentStage
                  ? STAGE_LABELS[data.batch.currentStage]
                  : 'Chưa bắt đầu'}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Số khâu hoàn thành</span>
              <span className="font-medium text-gray-900">
                {data.stageCount} / {STAGE_ORDER.length}
              </span>
            </div>
          </div>
        </div>

        {/* Journey progress */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Hành trình sản phẩm</h2>
          <div className="space-y-3">
            {STAGE_ORDER.map((stage, i) => {
              const done = i <= currentIdx
              const current = i === currentIdx
              return (
                <div key={stage} className="flex items-center gap-3">
                  <div className={`
                    w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0
                    ${done
                      ? current
                        ? 'bg-blue-500 text-white ring-2 ring-blue-300 ring-offset-1'
                        : 'bg-green-500 text-white'
                      : 'bg-gray-100 text-gray-400'}
                  `}>
                    {done ? (current ? STAGE_ICONS[stage] : '✓') : i + 1}
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm ${done ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
                      {STAGE_LABELS[stage]}
                    </p>
                  </div>
                  {current && (
                    <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">
                      Hiện tại
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center">
          <p className="text-xs text-gray-400 font-mono break-all">ID: {batchId}</p>
          <p className="text-xs text-gray-300 mt-1">Powered by TraceChain · Blockchain-based traceability</p>
        </div>
      </div>
    </div>
  )
}
