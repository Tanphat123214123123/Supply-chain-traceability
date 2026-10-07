/**
 * The API answers in English (it's also consumed by scripts and other
 * services). People using this UI shouldn't have to read "Batch has been
 * recalled — no further events allowed", so known messages are translated
 * here; anything unknown falls back to the caller's Vietnamese default rather
 * than leaking a raw server string.
 */
const MESSAGES: Array<[RegExp, string]> = [
  [/^Invalid credentials$/, 'Email hoặc mật khẩu không đúng.'],
  [/^Too many (login )?attempts/, 'Bạn thử quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.'],
  [/^Email already registered$/, 'Email này đã có tài khoản. Hãy đăng nhập thay vì đăng ký.'],
  [/^Workspace slug already taken$/, 'Mã không gian này đã có người dùng. Hãy chọn mã khác.'],
  [/^Invitation is invalid or has expired$/, 'Mã mời không hợp lệ, đã được dùng hoặc đã hết hạn. Hãy xin quản trị viên mã mới.'],
  [/^This invitation was issued for a different email address$/, 'Mã mời này dành cho một email khác.'],
  [/^Invitation not found, already used or already revoked$/, 'Lời mời đã được dùng hoặc đã bị thu hồi.'],
  [/^Batch not found$/, 'Không tìm thấy lô hàng.'],
  [/^Batch has been recalled/, 'Lô hàng đã bị thu hồi — không thể ghi thêm sự kiện.'],
  [/^Batch has already been recalled$/, 'Lô hàng này đã được thu hồi trước đó.'],
  [/^This batch has not been handed off to you yet$/, 'Lô hàng chưa được bàn giao cho bạn.'],
  [/^You must designate who handles the next stage/, 'Hãy chọn người tiếp nhận khâu tiếp theo.'],
  [/^Assigned actor account is inactive$/, 'Tài khoản người tiếp nhận đang bị khoá.'],
  [/^Assigned actor not found$/, 'Không tìm thấy người tiếp nhận.'],
  [/cannot handle stage/, 'Người được chọn không phụ trách khâu tiếp theo.'],
  [/is not permitted to record stage/, 'Vai trò của bạn không được ghi khâu này.'],
  [/^Current password is incorrect$/, 'Mật khẩu hiện tại không đúng.'],
  [/^Cannot deactivate your own account$/, 'Bạn không thể tự khoá tài khoản của mình.'],
  [/^Cannot change your own role/, 'Bạn không thể tự đổi vai trò của mình — nhờ quản trị viên khác.'],
  [/^Anomaly has already been resolved$/, 'Cảnh báo này đã được xử lý.'],
  [/^Validation failed$/, 'Dữ liệu chưa hợp lệ — kiểm tra lại các trường bắt buộc.'],
]

type ApiErr = { response?: { status?: number; data?: { error?: string } }; message?: string }

export function apiErrorMessage(err: unknown, fallback: string): string {
  const e = err as ApiErr
  const raw = e?.response?.data?.error
  if (!e?.response) return 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.'
  if (raw) {
    for (const [pattern, text] of MESSAGES) if (pattern.test(raw)) return text
  }
  if (e.response.status === 403) return 'Bạn không có quyền thực hiện thao tác này.'
  return fallback
}
