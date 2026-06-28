import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { batchApi, Batch, ROLE_LABELS, STAGE_LABELS } from '../api/client'

function StagePill({ stage }: { stage: Batch['currentStage'] }) {
  if (!stage) {
    return <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">Chưa bắt đầu</span>
  }
  return <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{STAGE_LABELS[stage]}</span>
}

export default function Dashboard() {
  const { actor, logout } = useAuth()
  const navigate = useNavigate()
  const [batches, setBatches] = useState<Batch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    batchApi.list()
      .then(setBatches)
      .catch(() => setError('Không thể tải danh sách lô hàng'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = batches.filter(
    (b) =>
      b.productName.toLowerCase().includes(search.toLowerCase()) ||
      b.origin.toLowerCase().includes(search.toLowerCase()) ||
      b.id.startsWith(search),
  )

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Topbar */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <span className="text-lg font-bold text-blue-700">🔗 TraceChain</span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 hidden sm:block">
            {actor?.name}
            <span className="text-gray-400 ml-1">· {actor ? ROLE_LABELS[actor.role] : ''}</span>
          </span>
          <button
            onClick={logout}
            className="text-sm text-red-500 hover:text-red-700 transition-colors"
          >
            Đăng xuất
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4">
        {/* Actions row */}
        <div className="flex items-center gap-3 mb-5">
          <input
            type="text"
            placeholder="Tìm theo tên sản phẩm, xuất xứ, ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => navigate('/record')}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium
                       px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
          >
            + Ghi sự kiện
          </button>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <p className="text-2xl font-bold text-gray-900">{batches.length}</p>
            <p className="text-xs text-gray-500 mt-0.5">Tổng lô hàng</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <p className="text-2xl font-bold text-green-600">
              {batches.filter((b) => !b.isRecalled).length}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Đang hoạt động</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <p className="text-2xl font-bold text-red-500">
              {batches.filter((b) => b.isRecalled).length}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Đã thu hồi</p>
          </div>
        </div>

        {/* Batch list */}
        {loading && <p className="text-center text-gray-400 py-16 text-sm">Đang tải...</p>}
        {error && <p className="text-center text-red-500 py-16 text-sm">{error}</p>}

        {!loading && !error && filtered.length === 0 && (
          <p className="text-center text-gray-400 py-16 text-sm">
            {search ? 'Không tìm thấy lô hàng phù hợp' : 'Chưa có lô hàng nào'}
          </p>
        )}

        <div className="space-y-2">
          {filtered.map((b) => (
            <Link
              key={b.id}
              to={`/batch/${b.id}`}
              className="bg-white rounded-xl border border-gray-200 p-4
                         hover:shadow-md hover:border-blue-200 transition-all flex items-center justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900 truncate">{b.productName}</span>
                  {b.isRecalled && (
                    <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full flex-shrink-0">
                      Thu hồi
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-0.5 truncate">
                  {b.productType} · {b.origin} · {b.quantity} {b.unit}
                </p>
                <p className="text-xs text-gray-300 mt-0.5 font-mono">{b.id.slice(0, 8)}…</p>
              </div>
              <div className="ml-4 flex flex-col items-end gap-1 flex-shrink-0">
                <StagePill stage={b.currentStage} />
                <span className="text-xs text-gray-400">
                  {new Date(b.createdAt).toLocaleDateString('vi-VN')}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
