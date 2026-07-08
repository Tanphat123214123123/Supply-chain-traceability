import { Link } from 'react-router-dom'
import { BookOpen } from 'lucide-react'
import { ROLE_LABELS, ROLE_STAGES, STAGE_ICONS, STAGE_LABELS, STAGE_ORDER, ActorRole } from '../api/client'
import { cardClass } from '../components/ui/Card'

const ROLES: ActorRole[] = ['FARMER', 'PROCESSOR', 'INSPECTOR', 'DISTRIBUTOR', 'RETAILER', 'ADMIN']

export default function HowItWorks() {
  return (
    <div className="page-shell p-4">
      <div className="max-w-2xl mx-auto py-8 space-y-5">
        <div className="text-center animate-slide-up">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-brand-500 to-emerald-500 flex items-center justify-center text-white mb-4 shadow-glow">
            <BookOpen className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">Cách TraceChain hoạt động</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">Giải thích ngắn gọn cơ chế đứng sau hệ thống truy xuất nguồn gốc</p>
        </div>

        <section className={cardClass({ padding: 'lg' })}>
          <h2 className="font-semibold text-slate-900 dark:text-slate-50 mb-3">1. Sáu khâu của chuỗi cung ứng</h2>
          <div className="flex flex-wrap gap-2">
            {STAGE_ORDER.map((s, i) => {
              const StageIcon = STAGE_ICONS[s]
              return (
              <div key={s} className="flex items-center gap-2">
                <span className="bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400 text-sm px-3 py-1.5 rounded-full font-medium inline-flex items-center gap-1.5">
                  <StageIcon className="w-4 h-4" /> {STAGE_LABELS[s]}
                </span>
                {i < STAGE_ORDER.length - 1 && <span className="text-slate-300 dark:text-slate-600">→</span>}
              </div>
              )
            })}
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-3">
            Mỗi lô hàng đi qua tuần tự các khâu này. Hệ thống ghi lại địa điểm, thời gian và người thực hiện ở mỗi khâu.
          </p>
        </section>

        <section className={cardClass({ padding: 'lg' })}>
          <h2 className="font-semibold text-slate-900 dark:text-slate-50 mb-3">2. Hash-chain — chuỗi băm bất biến</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 mb-2">
            Mỗi sự kiện được ký HMAC-SHA256, và chữ ký đó bao gồm cả hash của sự kiện <em>trước đó</em>:
          </p>
          <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3.5 font-mono text-xs text-slate-600 dark:text-slate-300 border border-slate-100 dark:border-slate-700">
            hash(sự kiện N) = HMAC-SHA256(dữ liệu N + hash(sự kiện N-1), khoá ký riêng)
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">
            Nếu ai đó sửa dữ liệu của một sự kiện cũ, hash của nó thay đổi — kéo theo mọi hash phía sau đều sai lệch.
            Hệ thống phát hiện điều này ngay khi tính lại toàn bộ chuỗi.
            Bạn có thể tự kiểm chứng bằng <Link to="/verify" className="text-brand-600 dark:text-brand-400 hover:underline font-medium">Công cụ xác minh độc lập</Link>.
          </p>
        </section>

        <section className={cardClass({ padding: 'lg' })}>
          <h2 className="font-semibold text-slate-900 dark:text-slate-50 mb-3">3. Bàn giao custody rõ ràng</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Mỗi lô hàng chỉ có <strong>một</strong> người đang giữ trách nhiệm xử lý tại một thời điểm. Khi hoàn tất
            một khâu, người thực hiện phải chỉ định cụ thể ai tiếp nhận khâu kế tiếp — không ai khác có thể "tiện tay"
            ghi đè lên lô hàng chưa được bàn giao cho mình.
          </p>
        </section>

        <section className={cardClass({ padding: 'lg' })}>
          <h2 className="font-semibold text-slate-900 dark:text-slate-50 mb-3">4. Phân quyền theo vai trò</h2>
          <div className="space-y-2">
            {ROLES.map((r) => (
              <div key={r} className="flex items-center justify-between text-sm">
                <span className="text-slate-700 dark:text-slate-300 font-medium">{ROLE_LABELS[r]}</span>
                <span className="text-slate-400 dark:text-slate-500">{ROLE_STAGES[r].map((s) => STAGE_LABELS[s]).join(', ')}</span>
              </div>
            ))}
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-3">
            Mỗi vai trò chỉ được ghi sự kiện cho khâu tương ứng — nông dân không thể tự ghi "đã kiểm định chất lượng".
          </p>
        </section>

        <section className={cardClass({ padding: 'lg' })}>
          <h2 className="font-semibold text-slate-900 dark:text-slate-50 mb-3">5. Phát hiện bất thường</h2>
          <ul className="text-sm text-slate-600 dark:text-slate-300 space-y-1.5 list-disc list-inside">
            <li><strong>Bỏ khâu:</strong> ghi nhận một khâu mà bỏ qua khâu bắt buộc trước đó.</li>
            <li><strong>Trùng khâu:</strong> một khâu được ghi nhận nhiều lần cho cùng một lô hàng.</li>
            <li><strong>Sai thứ tự:</strong> khâu được ghi sau một khâu có thứ tự cao hơn.</li>
          </ul>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-3">
            Mọi bất thường được lưu lại và hiển thị cho ADMIN xử lý tại trang Giám sát bất thường.
          </p>
        </section>

        <section className={cardClass({ padding: 'lg' })}>
          <h2 className="font-semibold text-slate-900 dark:text-slate-50 mb-3">6. Tra cứu công khai</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Người tiêu dùng quét mã QR trên bao bì sẽ được dẫn tới trang tra cứu công khai — xem được nguồn gốc,
            hành trình và trạng thái xác thực mà không cần đăng nhập.
          </p>
        </section>
      </div>
    </div>
  )
}
