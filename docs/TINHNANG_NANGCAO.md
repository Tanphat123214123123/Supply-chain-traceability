# Tính Năng Nâng Cao — TraceChain

Danh sách tính năng có thể mở rộng sau khi hoàn thành MVP (giai đoạn 2+).

---

## 1. Tạo và Quét QR Code

**Mô tả:** Tự động sinh QR code cho mỗi lô hàng. Người tiêu dùng quét bằng điện thoại để xem `/provenance/:id`.

**Implement:**
- Backend: `GET /api/batches/:id/qr` → trả về SVG/PNG (dùng `qrcode` npm package)
- Frontend: Hiển thị QR trong BatchDetail, cho phép in hoặc tải về
- Mobile: Màn hình Provenance tối ưu cho điện thoại

**Độ phức tạp:** Thấp — 1–2 ngày

---

## 2. Phân quyền nâng cao (Fine-grained RBAC)

**Mô tả:** Ngoài role cố định, cho phép ADMIN cấp quyền tùy chỉnh: ví dụ PROCESSOR được phép ghi QUALITY_CHECK cho một lô hàng cụ thể.

**Implement:**
- Bảng `actor_permissions(actor_id, batch_id, stage)` trong DB
- `authService.grantPermission(actorId, batchId, stage)`
- `SupplyChainService.recordEvent` kiểm tra bảng này nếu role không đủ quyền

**Độ phức tạp:** Trung bình — 3–4 ngày

---

## 3. Cảnh báo Real-time (WebSocket)

**Mô tả:** Khi phát hiện anomaly hoặc có batch bị thu hồi, gửi thông báo real-time đến tất cả ADMIN đang online.

**Implement:**
- Backend: `ws` hoặc `socket.io` trên cùng port
- Frontend: `useWebSocket` hook, notification banner
- Event: `batch.recalled`, `anomaly.detected`

**Độ phức tạp:** Trung bình — 3–5 ngày

---

## 4. Báo cáo & Thống kê

**Mô tả:** Dashboard ADMIN có biểu đồ: số lô hàng theo ngày, phân bổ theo khâu, số lô bị thu hồi, anomaly rate.

**Implement:**
- Backend: `GET /api/stats/overview`, `GET /api/stats/by-stage`
- Frontend: Chart component (dùng `recharts` hoặc `chart.js`)
- Export: CSV/PDF báo cáo tháng

**Độ phức tạp:** Trung bình — 4–6 ngày

---

## 5. Đa ngôn ngữ (i18n)

**Mô tả:** Hỗ trợ Tiếng Việt + Tiếng Anh. Người dùng chuyển ngôn ngữ trong settings.

**Implement:**
- `i18next` + `react-i18next`
- File `locales/vi.json` và `locales/en.json`
- `LanguageSwitcher` component trong Topbar

**Độ phức tạp:** Thấp — 2–3 ngày (nhiều text cần dịch)

---

## 6. Ký số sự kiện (Digital Signature)

**Mô tả:** Mỗi sự kiện được ký bằng private key của actor. Người xem có thể verify chữ ký mà không cần tin vào server.

**Implement:**
- Backend: Lưu `actorPublicKey` trong bảng actors
- Khi ghi event: server ký bằng server key hoặc client ký bằng Web Crypto API
- `verifyEventSignature(event, publicKey)` trong `hashChain.ts`
- Frontend: Hiển thị "Đã ký số" badge trong Timeline

**Độ phức tạp:** Cao — 1–2 tuần

---

## 7. PostgreSQL Full Implementation

**Mô tả:** Thay thế InMemory repo bằng PostgreSQL thật. Cần khi dữ liệu vượt RAM hoặc cần persistence.

**Implement:**
- `PostgresBatchRepo`, `PostgresEventRepo`, `PostgresActorRepo` trong `src/repository/postgres/`
- Connection pool với `pg` hoặc `@databases/pg`
- Migration runner (flyway, node-pg-migrate, hoặc tự viết)
- `bootstrap.ts`: đọc `DATABASE_URL` env, chọn PostgreSQL repo nếu có

**File cần sửa:**
- `backend/src/repository/postgres/batchRepo.ts` — implement đầy đủ
- `backend/src/repository/postgres/eventRepo.ts` — implement đầy đủ
- `backend/src/repository/postgres/actorRepo.ts` — implement đầy đủ
- `backend/src/bootstrap.ts` — swap repos dựa theo env

**Độ phức tạp:** Trung bình — 3–5 ngày

---

## 8. Audit Log

**Mô tả:** Ghi lại mọi hành động của người dùng: login, tạo batch, ghi event, thu hồi. Không thể xóa hoặc sửa.

**Implement:**
- Bảng `audit_logs(id, actor_id, action, entity_type, entity_id, metadata, timestamp)`
- Middleware `auditLogger` tự động ghi mọi POST/PATCH request
- `GET /api/admin/audit-logs` — chỉ ADMIN

**Độ phức tạp:** Thấp — 2 ngày

---

## 9. Môi trường Production

**Mô tả:** Hardening cho production: rate limiting, HTTPS, helmet, secrets management.

**Implement:**
- `express-rate-limit`: giới hạn 100 req/phút mỗi IP
- `helmet`: bảo vệ HTTP headers
- `cors`: whitelist domain frontend
- `.env` → secrets manager (Vault, AWS Secrets Manager)
- Nginx reverse proxy trong Docker Compose

**Độ phức tạp:** Thấp-Trung bình — 2–3 ngày

---

## 10. Mobile App (React Native)

**Mô tả:** App cho FARMER và INSPECTOR để ghi sự kiện ngay tại hiện trường, không cần browser.

**Implement:**
- React Native + Expo
- Sử dụng cùng `api/client.ts` logic (chia sẻ types)
- Camera quét QR bằng `expo-camera`
- Offline support: queue events khi mất mạng, sync khi có kết nối

**Độ phức tạp:** Cao — 3–4 tuần riêng biệt

---

## Thứ tự ưu tiên đề xuất

```
MVP hoàn chỉnh (tuần 12)
    ↓
[1] PostgreSQL full implementation     ← Cần thiết cho production
[2] QR Code generation                 ← Demo value cao
[3] Audit Log                          ← Compliance
[4] Production hardening               ← Security
[5] Báo cáo & Thống kê                ← Business value
[6] Real-time alerts                   ← UX enhancement
[7] Digital Signature                  ← Trust maximization
[8] Fine-grained RBAC                  ← Enterprise feature
[9] i18n                               ← Scale to market
[10] Mobile App                        ← Major effort, high value
```
