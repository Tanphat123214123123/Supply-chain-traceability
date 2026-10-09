import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { LayoutGrid, List } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { actorsApi, Actor, ActorRole, PartnerSummary, ROLE_LABELS } from '../api/client'
import PageHeader from '../components/ui/PageHeader'
import Badge, { BadgeTone } from '../components/ui/Badge'
import { cardClass } from '../components/ui/Card'
import { SkeletonCardList } from '../components/ui/Skeleton'
import InvitePanel from '../components/InvitePanel'
import { apiErrorMessage } from '../lib/apiError'

const ROLE_TONE: Record<ActorRole, BadgeTone> = {
  FARMER: 'success',
  PROCESSOR: 'orange',
  INSPECTOR: 'info',
  DISTRIBUTOR: 'warning',
  RETAILER: 'brand',
  ADMIN: 'danger',
}

export default function Actors() {
  const { actor: me, hasRole } = useAuth()
  const [actors, setActors] = useState<Actor[]>([])
  const [partners, setPartners] = useState<PartnerSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [actionError, setActionError] = useState('')
  const [searchParams] = useSearchParams()
  const isAdmin = hasRole('ADMIN')
  const welcome = searchParams.get('welcome') === '1' && isAdmin

  const load = () => {
    setLoading(true)
    Promise.all([actorsApi.list(), actorsApi.partners()])
      .then(([a, p]) => {
        setActors(a)
        setPartners(p)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const toggleStatus = async (target: Actor) => {
    setBusyId(target.id)
    setActionError('')
    try {
      await actorsApi.setStatus(target.id, !target.isActive)
      load()
    } catch (err) {
      setActionError(apiErrorMessage(err, 'Không thể cập nhật trạng thái tài khoản.'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page-shell">
      <main className="page-container space-y-4">
        <PageHeader title="Đối tác trong chuỗi cung ứng" subtitle="Toàn bộ tổ chức và tài khoản đang tham gia mạng lưới." />

        {welcome && (
          <div className="bg-brand-50 dark:bg-brand-500/10 border border-brand-100 dark:border-brand-500/20 rounded-2xl p-4 text-sm text-brand-800 dark:text-brand-300">
            <p className="font-semibold">Không gian làm việc đã sẵn sàng.</p>
            <p className="mt-1">
              Bước tiếp theo: mời các đối tác trong chuỗi — nông hộ, nhà chế biến, kiểm định, phân phối, bán lẻ. Mỗi người nhận một mã mời
              gắn sẵn vai trò.
            </p>
          </div>
        )}

        {isAdmin && <InvitePanel />}

        {actionError && (
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
            {actionError}
          </p>
        )}

        <div className={cardClass()}>
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Theo tổ chức</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {partners.map((p) => (
              <div key={p.organization} className="bg-slate-50 dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-50 truncate">{p.organization}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {p.actorCount} người · {p.roles.map((r) => ROLE_LABELS[r]).join(', ')}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className={cardClass()}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Danh sách tài khoản</h2>
            <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setView('list')}
                aria-label="Xem dạng danh sách"
                className={`p-1.5 rounded-md transition-colors ${view === 'list' ? 'bg-white dark:bg-slate-700 shadow-sm text-brand-600 dark:text-brand-400' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
              >
                <List className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setView('grid')}
                aria-label="Xem dạng lưới"
                className={`p-1.5 rounded-md transition-colors ${view === 'grid' ? 'bg-white dark:bg-slate-700 shadow-sm text-brand-600 dark:text-brand-400' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
          </div>

          {loading && <SkeletonCardList rows={4} />}

          {!loading && view === 'list' && (
            <div className="space-y-2">
              {actors.map((a, i) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-3 border border-slate-100 dark:border-slate-800 rounded-xl p-3 hover:border-brand-200 dark:hover:border-brand-500/40 transition-colors animate-slide-up"
                  style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                >
                  <Link to={`/actors/${a.id}`} className="min-w-0 flex-1 flex items-center gap-3">
                    <span className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-emerald-500 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                      {a.name.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-50 truncate flex items-center gap-2">
                        {a.name}
                        {!a.isActive && <Badge tone="neutral">Đã khoá</Badge>}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 truncate">
                        {a.organization} · {ROLE_LABELS[a.role]}
                        {a.email && ` · ${a.email}`}
                      </p>
                    </div>
                  </Link>
                  {isAdmin && a.id !== me?.id && (
                    <button
                      type="button"
                      disabled={busyId === a.id}
                      onClick={() => toggleStatus(a)}
                      className={`text-xs px-3 py-1.5 rounded-lg flex-shrink-0 font-medium transition-colors disabled:opacity-60 ${
                        a.isActive
                          ? 'bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20'
                          : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20'
                      }`}
                    >
                      {a.isActive ? 'Khoá' : 'Mở khoá'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {!loading && view === 'grid' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {actors.map((a, i) => (
                <Link
                  key={a.id}
                  to={`/actors/${a.id}`}
                  className={cardClass({ hover: true, padding: 'md', className: 'animate-scale-in' })}
                  style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <span className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-500 to-emerald-500 text-white flex items-center justify-center text-base font-bold flex-shrink-0">
                      {a.name.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">{a.name}</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{a.organization}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge tone={ROLE_TONE[a.role]}>{ROLE_LABELS[a.role]}</Badge>
                    {!a.isActive && <Badge tone="neutral">Đã khoá</Badge>}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
