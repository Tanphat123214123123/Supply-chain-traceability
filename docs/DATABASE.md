# Cơ sở dữ liệu TraceChain

Tài liệu này dành cho người phát triển và vận hành hệ thống. Nó mô tả cách schema được quản lý, các bảo đảm mà **chính PostgreSQL** thực thi (không phụ thuộc vào code ứng dụng), đặc tả hash để bên thứ ba tự xác minh, và quy trình vận hành.

---

## 1. Tổng quan

- **PostgreSQL 16 là nơi lưu trữ duy nhất.** Chế độ in-memory và snapshot JSON đã bị loại bỏ. Test cũng chạy trên Postgres thật.
- Có **hai role** với hai mục đích khác nhau:

| Role | Dùng cho | Quyền |
|---|---|---|
| Chủ schema (ví dụ `tracechain`) | Chỉ `npm run migrate` | DDL, tạo role, GRANT |
| `tracechain_app` | API server khi chạy | Đọc/ghi tối thiểu, chịu RLS, **không** DDL |

- Mọi thao tác nghiệp vụ chạy trong **một transaction gắn với một tenant** (`Database.withTenant`, file `src/db/database.ts`). Nhờ vậy mỗi thao tác có tính nguyên tử, và RLS biết đang phục vụ tenant nào.

## 2. Migration

```bash
npm run migrate          # dev (ts-node)
node dist/db/migrate.js  # production / container
```

- Các file SQL nằm trong `backend/migrations/`, đặt tên `NNN_mo_ta.sql` và chạy theo thứ tự số.
- Bảng `schema_migrations` lưu version, tên và **checksum SHA-256** của từng file đã chạy.
- **Không bao giờ sửa một migration đã chạy.** Migrator so checksum và từ chối chạy nếu phát hiện file bị sửa. Muốn thay đổi thì viết migration mới.
- Mỗi file chạy trong transaction riêng. Toàn bộ quá trình giữ một advisory lock, nên hai replica khởi động cùng lúc không chạy chồng lên nhau.
- API server **từ chối khởi động** nếu schema còn migration chưa chạy, chưa khởi tạo, hoặc có file đã bị sửa.
- Biến môi trường:
  - `MIGRATION_DATABASE_URL`: kết nối bằng role chủ schema. Nếu không đặt thì dùng `DATABASE_URL`, chỉ nên làm vậy với DB local dùng một lần.
  - `APP_DB_PASSWORD`: nếu đặt, migrator bật `LOGIN` cho `tracechain_app` với mật khẩu này.

| File | Nội dung |
|---|---|
| 001–005 | Schema ban đầu: actors, batches, trace_events, anomalies, audit_logs, refresh_tokens, tenants |
| 006 | `tenant_id` cho `trace_events` và `refresh_tokens`; FK kép `(id, tenant_id)`; các CHECK; `updated_at` |
| 007 | Hash v2, head của chuỗi trên `batches`, trigger kiểm tra liên kết khi INSERT, trigger chỉ-ghi-thêm (append-only) |
| 008 | Index theo đúng các truy vấn thực tế (tenant + thời gian, trigram cho tìm kiếm) |
| 009 | Role `tracechain_app`, quyền theo từng cột, RLS, các hàm `SECURITY DEFINER` |

## 3. Bảo đảm do database thực thi

Các bảo đảm dưới đây vẫn đúng **kể cả khi code ứng dụng có bug**. Mỗi mục có test riêng trong `tests/dbInvariants.test.ts`.

### 3.1 Cách ly tenant

- **RLS** được bật trên `actors`, `batches`, `trace_events`, `anomalies`, `audit_logs`, `refresh_tokens`. Mỗi policy so `tenant_id` với `app_current_tenant()`, tức giá trị `app.tenant_id` mà ứng dụng đặt bằng `set_config(..., true)` cho từng transaction.
- Query chạy ngoài transaction tenant **không thấy gì và không ghi được gì**. Lỗi quên lọc tenant vì vậy luôn an toàn, không bao giờ làm lộ dữ liệu.
- **FK kép** `(x_id, tenant_id) → (id, tenant_id)` khiến không thể tạo tham chiếu chéo tenant. Ví dụ: không thể tạo batch có người tạo thuộc tenant khác.
- Một số thao tác diễn ra *trước khi* biết tenant. Mỗi thao tác này đi qua một hàm `SECURITY DEFINER` chỉ trả về định danh, không trả dữ liệu nghiệp vụ:
  - `resolve_batch_tenant(batch_id)`: cho trang QR công khai.
  - `auth_lookup_actor(email)`: cho đăng nhập và đăng ký.
  - `auth_consume_refresh_token(hash)`: thu hồi token và trả về chủ sở hữu trong **một câu lệnh**, nên hai request dùng cùng một token không thể cùng thành công.
  - `auth_revoke_refresh_token(hash)`: cho đăng xuất.
  - `purge_stale_refresh_tokens()`: dọn các phiên đã hết hạn, chạy mỗi giờ.

### 3.2 Quyền tối thiểu của `tracechain_app`

- Bảng `trace_events` và `audit_logs`: chỉ có `SELECT` và `INSERT`.
- Bảng `batches`: chỉ được `UPDATE` các cột `current_stage`, `assigned_to_actor_id`, `is_recalled`, `recall_reason`. **Không** được ghi `head_hash` hay `event_count`.
- Không được DDL, không `TRUNCATE`, không `DELETE` bảng nghiệp vụ nào.
- Khi chạy production, server **từ chối khởi động** nếu kết nối bằng superuser, role có `BYPASSRLS`, hoặc role sở hữu bảng. Có thể ghi đè bằng `ALLOW_PRIVILEGED_DB_ROLE=true`, nhưng không nên.

### 3.3 Sổ cái chỉ ghi thêm

- Trigger chặn `UPDATE`, `DELETE` và `TRUNCATE` trên `trace_events` và `audit_logs`, **kể cả với chủ bảng**.
- Trigger `ledger_append_event`, chạy trước mỗi INSERT vào `trace_events`:
  1. Khóa dòng batch.
  2. Kiểm tra `sequence_number = batches.event_count` và `prev_hash = batches.head_hash`.
  3. Chặn ghi nếu batch đã bị thu hồi.
  4. Tiến head lên event mới.

  Vì vậy không ai fork, ghi lại (replay) hay ghi xen vào chuỗi được, kể cả khi code ứng dụng có bug.
- Trigger `batches_guard_update` chặn ba việc: hủy một lần thu hồi, lùi `current_stage`, và lùi `event_count`.

### 3.4 Giới hạn (nói thẳng)

- **Superuser** có thể tắt trigger (`session_replication_role = replica`) và sửa mọi thứ. Khi đó:
  - Sửa nội dung một event: lần quét toàn vẹn kế tiếp sẽ phát hiện.
  - Xóa các event cuối mà **không** sửa head: cũng bị phát hiện, vì chuỗi không còn khớp với head.
  - Nhưng một superuser đủ kiên nhẫn có thể **viết lại toàn bộ chuỗi lẫn head cho khớp nhau**. Hash v2 không dùng bí mật, nên không gì trong database ngăn được việc này.
- Đó chính là việc của **giai đoạn 1: neo Merkle root lên blockchain công khai**. Khi đã neo, việc viết lại chuỗi sẽ mâu thuẫn với dữ liệu đã nằm trên chain, và ai cũng kiểm tra được.
- Hash chain chỉ chứng minh dữ liệu **không bị sửa sau khi ghi**. Nó không chứng minh dữ liệu **đúng ngay lúc nhập**. Phần đó cần cân bằng khối lượng và bằng chứng hiện trường, thuộc giai đoạn 1 và 2.

## 4. Đặc tả hash sự kiện

### v2 (từ migration 007, mặc định cho mọi event mới)

```
hash = hex( SHA-256( UTF-8( JCS(preimage) ) ) )
```

- `JCS` là chuẩn hóa JSON theo **RFC 8785**: khóa sắp xếp theo đơn vị mã UTF-16, số theo dạng ngắn nhất của ECMAScript, không có khoảng trắng thừa. Hầu hết ngôn ngữ đều có thư viện JCS sẵn.
- `preimage` là object sau. Tất cả trường đều bắt buộc có mặt:

| Khóa | Giá trị |
|---|---|
| `v` | số `2` |
| `salt` | 64 ký tự hex, ngẫu nhiên cho từng event (32 byte) |
| `batchId` | UUID dạng chữ thường |
| `sequenceNumber` | số nguyên, bắt đầu từ 0 |
| `prevHash` | hash của event trước, hoặc 64 số `0` với event đầu tiên |
| `stage` | ví dụ `"HARVEST"` |
| `actorId` | UUID |
| `timestamp` | ISO-8601 UTC, đủ mili giây, ví dụ `"2026-01-01T00:00:00.000Z"` |
| `location` | chuỗi |
| `notes` | chuỗi, hoặc `null` |
| `data` | object JSON, `{}` nếu trống |

Cách tự xác minh một lô hàng:

1. Gọi `GET /api/trace/public/{batchId}/full`. Endpoint này công khai và trả về đủ mọi trường kể cả `salt`.
2. Với từng event, dựng `preimage` như bảng trên, chuẩn hóa bằng JCS rồi tính SHA-256. Kết quả phải bằng `hash`.
3. Kiểm tra `prevHash` của mỗi event bằng `hash` của event trước, và `sequenceNumber` liên tục từ 0.
4. So hash cuối cùng và số event với `headHash` / `eventCount` của lô.

Code tham chiếu nằm ở `src/ledger/hashChain.ts`. Test `traceService.test.ts` có một bộ xác minh độc lập chỉ dùng JCS và SHA-256.

**Vì sao có `salt`:** khi hash được neo công khai ở giai đoạn 1, người chỉ thấy hash có thể thử vét cạn các trường ít biến thể (giai đoạn, khối lượng…) để đoán ngược nội dung. Salt ngẫu nhiên khiến việc đó bất khả thi. Salt chỉ được công bố kèm dữ liệu event, cho người có quyền xem lô hàng đó.

### v1 (cũ)

- Là HMAC-SHA256 với khóa `LEDGER_SIGNING_KEY`, chỉ máy chủ xác minh được. Các event cũ được giữ nguyên, **không viết lại lịch sử**.
- Khi còn event v1 trong DB, hãy giữ `LEDGER_SIGNING_KEY` cũ. Thiếu khóa thì các event đó bị báo `UNVERIFIABLE_LEGACY`.
- Event v2 nối tiếp event v1 trong cùng một chuỗi bình thường.

## 5. Vận hành

### Chạy local bằng Docker Compose

```bash
docker compose up --build
```

Thứ tự khởi động: `postgres` → `migrate` (service chạy một lần rồi thoát) → `backend` (kết nối bằng `tracechain_app`) → `frontend`.

> **Nếu volume dev được tạo bằng phiên bản compose cũ** (có bind mount `docker-entrypoint-initdb.d`), DB đó không có `schema_migrations` và có thể đã chạy dở các migration mới. Volume dev chỉ chứa dữ liệu demo tự seed, nên cách sạch nhất là tạo lại: `docker compose down -v && docker compose up --build`. **Lệnh này xóa dữ liệu trong volume**, đừng chạy nếu volume chứa dữ liệu thật.

### Chạy backend ngoài Docker

```bash
cp .env.example .env     # điền JWT_SECRET
npm run migrate          # dùng MIGRATION_DATABASE_URL (role chủ schema)
npm run dev              # dùng DATABASE_URL (tracechain_app)
```

### Test

- Chạy `npm test`. Máy cần có Docker: Testcontainers sẽ tự dựng Postgres.
- Hoặc đặt `TEST_DATABASE_URL` trỏ tới một Postgres có quyền superuser. CI dùng cách này.
- Migration chỉ chạy một lần vào database mẫu (template). Mỗi Jest worker được nhân bản một database riêng, và mỗi test bắt đầu từ bảng rỗng.
- App trong test kết nối bằng `tracechain_app` thật, nên RLS và phân quyền được kiểm tra đúng như production.

### Cấu hình pool

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `DATABASE_POOL_MAX` | 10 | Số kết nối tối đa |
| `DATABASE_STATEMENT_TIMEOUT_MS` | 15000 | Giới hạn thời gian mỗi câu lệnh |
| `DATABASE_IDLE_TX_TIMEOUT_MS` | 30000 | Giới hạn thời gian transaction nằm chờ |
| `DATABASE_CONNECT_TIMEOUT_MS` | 5000 | Giới hạn thời gian mở kết nối |
| `DATABASE_SSL` | (trống) | `require` hoặc `no-verify` khi dùng DB managed |

### Sao lưu và khôi phục (PITR)

PITR (khôi phục về một thời điểm bất kỳ) phụ thuộc nơi triển khai, nên **không nằm trong docker-compose dev**. Yêu cầu tối thiểu cho môi trường thật:

1. Bật lưu WAL liên tục:
   - Dịch vụ managed (RDS, Cloud SQL, Supabase, Neon…): bật PITR trong cấu hình.
   - Tự host: dùng pgBackRest hoặc WAL-G với `archive_mode=on`, đẩy WAL lên object storage.
2. Chụp base backup hằng ngày. Giữ tối thiểu 7 ngày; trong giai đoạn pilot nên giữ 30 ngày.
3. **Diễn tập khôi phục mỗi tháng** vào một môi trường riêng:
   1. Khôi phục về một thời điểm cụ thể.
   2. Chạy `node dist/db/migrate.js`. Nếu schema đã đúng thì lệnh này không làm gì.
   3. Khởi động API.
   4. Gọi `POST /api/admin/scan-integrity`. Kết quả phải không có chuỗi hỏng.

   Backup chưa từng được khôi phục thử thì coi như không có.
4. Đặt mục tiêu và ghi lại: RPO ≤ 5 phút (lượng dữ liệu tối đa chấp nhận mất), RTO ≤ 1 giờ (thời gian tối đa để hệ thống chạy lại).

### Giám sát nên có

- `/health` trả về 503 khi mất kết nối DB. Dùng endpoint này cho readiness probe.
- Log khởi động có dòng `Integrity scan flagged N batch(es)`. Cảnh báo khi N > 0.
- Bật extension `pg_stat_statements` và theo dõi các truy vấn chậm nhất.
