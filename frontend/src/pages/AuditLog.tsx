import { useEffect, useState } from 'react'
import {
  LogIn,
  ShieldX,
  UserPlus,
  UserCog,
  KeyRound,
  PackagePlus,
  PenSquare,
  Siren,
  CheckCircle2,
  Unlock,
  Lock,
  type LucideIcon,
} from 'lucide-react'
import { adminApi, AuditLogEntry } from '../api/client'
import PageHeader from '../components/ui/PageHeader'
import { cardClass } from '../components/ui/Card'
import { SkeletonCardList } from '../components/ui/Skeleton'

const PAGE_SIZE = 20

const ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: 'Đăng nhập thành công',
  LOGIN_FAILED: 'Đăng nhập thất bại',
  ACTOR_REGISTERED: 'Đăng ký tài khoản',
  PROFILE_UPDATED: 'Cập nhật hồ sơ',
  PASSWORD_CHANGED: 'Đổi mật khẩu',
  BATCH_CREATED: 'Tạo lô hàng',
  EVENT_RECORDED: 'Ghi sự kiện',
  BATCH_RECALLED: 'Thu hồi lô hàng',
  ANOMALY_RESOLVED: 'Duyệt bất thường',
  ACTOR_ACTIVATED: 'Mở khoá tài khoản',
  ACTOR_DEACTIVATED: 'Khoá tài khoản',
  ACTOR_ROLE_CHANGED: 'Đổi vai trò',
}

const ACTION_ICONS: Record<string, LucideIcon> = {
  LOGIN_SUCCESS: LogIn,
  LOGIN_FAILED: ShieldX,
  ACTOR_REGISTERED: UserPlus,
  PROFILE_UPDATED: UserCog,
  PASSWORD_CHANGED: KeyRound,
  BATCH_CREATED: PackagePlus,
  EVENT_RECORDED: PenSquare,
  BATCH_RECALLED: Siren,
  ANOMALY_RESOLVED: CheckCircle2,
  ACTOR_ACTIVATED: Unlock,
  ACTOR_DEACTIVATED: Lock,
  ACTOR_ROLE_CHANGED: UserCog,
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (sameDay(d, today)) return 'Hôm nay'
  if (sameDay(d, yesterday)) return 'Hôm qua'
  return d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
}

function groupByDay(items: AuditLogEntry[]): Array<{ label: string; items: AuditLogEntry[] }> {
  const groups: Array<{ label: string; items: AuditLogEntry[] }> = []
  for (const item of items) {
    const label = dayLabel(item.createdAt)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}

export default function AuditLog() {
  const [items, setItems] = useState<AuditLogEntry[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    adminApi.auditLogs(page, PAGE_SIZE)
      .then((res) => {
        setItems(res.items)
        setTotal(res.total)
      })
      .finally(() => setLoading(false))
  }, [page])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="page-shell">
      <main className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
        <PageHeader
          title="Nhật ký kiểm toán"
          subtitle="Mọi thao tác ảnh hưởng đến hệ thống đều được ghi lại, không thể xoá."
          action={<span className="text-sm text-slate-400 dark:text-slate-500">{total} bản ghi</span>}
        />

        {loading && <SkeletonCardList rows={6} />}

        {!loading && groupByDay(items).map((group) => (
          <div key={group.label} className={cardClass()}>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-5">{group.label}</h3>
            <div className="relative">
              <div className="absolute left-[15px] top-4 bottom-4 w-px bg-gradient-to-b from-brand-200 dark:from-brand-500/30 via-slate-200 dark:via-slate-700 to-transparent" />
              <div className="space-y-3">
                {group.items.map((e, i) => {
                  const ActionIcon = ACTION_ICONS[e.action] ?? PenSquare
                  return (
                    <div
                      key={e.id}
                      className="relative pl-10 animate-fade-in"
                      style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}
                    >
                      <div className="absolute left-0 w-8 h-8 rounded-full bg-gradient-to-br from-brand-50 to-brand-100 dark:from-brand-500/10 dark:to-brand-500/20 border-2 border-brand-200 dark:border-brand-500/30 flex items-center justify-center text-brand-600 dark:text-brand-400 select-none shadow-sm">
                        <ActionIcon className="w-4 h-4" />
                      </div>
                      <div className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 border border-slate-100 dark:border-slate-700">
                        <div className="min-w-0">
                          <p className="text-sm text-slate-900 dark:text-slate-50 font-medium">{ACTION_LABELS[e.action] ?? e.action}</p>
                          <p className="text-xs text-slate-400 dark:text-slate-500 truncate">
                            {e.entityType}
                            {e.entityId && ` · ${e.entityId.slice(0, 8)}…`}
                          </p>
                        </div>
                        <span className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">
                          {new Date(e.createdAt).toLocaleTimeString('vi-VN')}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ))}

        {!loading && total > 0 && (
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              ← Trước
            </button>
            <span className="text-xs text-slate-400 dark:text-slate-500">Trang {page} / {totalPages}</span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              Sau →
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
