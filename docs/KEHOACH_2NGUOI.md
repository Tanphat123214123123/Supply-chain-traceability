# Kế hoạch 2 Người — TraceChain (12 tuần)

## Phân vai

### Người A — Core Backend & Ledger
Trái tim hệ thống. Xử lý toàn bộ nghiệp vụ, dữ liệu, và API.

### Người B — Auth, DevOps & Frontend
Xây dựng giao diện, bảo mật, và cơ sở hạ tầng.

---

## Giai đoạn 1 — Nền tảng (Tuần 1–2)

| Tuần | Người A                                               | Người B                                              |
|------|-------------------------------------------------------|------------------------------------------------------|
| 1    | Khảo sát bài toán, nghiên cứu hash-chain vs blockchain | Nghiên cứu RBAC, dựng repo + Docker skeleton        |
| 2    | Thiết kế domain model, types, hash-chain ledger        | Thiết kế kiến trúc tổng thể, CI/CD pipeline cơ bản |

**Deliverable:** `domain/types.ts`, `ledger/hashChain.ts`, `docker-compose.yml`, CI config.

---

## Giai đoạn 2 — Backend Core (Tuần 3–5)

| Tuần | Người A                                          | Người B                                        |
|------|--------------------------------------------------|------------------------------------------------|
| 3    | Repository interfaces + InMemory implementation  | AuthService (JWT + bcrypt), auth routes        |
| 4    | SupplyChainService: createBatch, recordEvent     | Middleware auth + error, route structure       |
| 5    | AnomalyDetector, traceForward/Backward, recall   | Integration tests cho auth, seed data setup   |

**Deliverable:** Backend chạy được với in-memory, demo script hoạt động.

---

## Giai đoạn 3 — API + Tests (Tuần 6–7)

| Tuần | Người A                                              | Người B                                          |
|------|------------------------------------------------------|--------------------------------------------------|
| 6    | Hoàn thiện tất cả API routes, error handling         | Unit tests hashChain, service tests             |
| 7    | Review + fix bugs, viết migration SQL cho PostgreSQL | Postman collection, API documentation           |

**Deliverable:** 21+ tests pass, API spec đầy đủ.

---

## Giai đoạn 4 — PostgreSQL (Tuần 8)

| Người A                                          | Người B                                        |
|--------------------------------------------------|------------------------------------------------|
| Implement PostgresBatchRepo, EventRepo, ActorRepo| Docker Compose cập nhật với postgres service   |
| Migration script `001_init.sql`                  | Health check, environment config               |

**Deliverable:** Backend chạy với PostgreSQL thật.

---

## Giai đoạn 5 — Frontend (Tuần 9–11)

| Tuần | Người A                                           | Người B                                          |
|------|---------------------------------------------------|--------------------------------------------------|
| 9    | Review + support API cho frontend                 | Login, AuthContext, Dashboard cơ bản            |
| 10   | Anomaly reporting endpoint, batch stats API       | RecordEvent form, BatchDetail + Timeline        |
| 11   | Tối ưu query, pagination cho batch list           | Provenance page (QR public), QRScanner          |

**Deliverable:** Frontend hoạt động end-to-end với backend.

---

## Giai đoạn 6 — Hoàn thiện & Demo (Tuần 12)

| Người A                               | Người B                                     |
|---------------------------------------|---------------------------------------------|
| Performance review, security audit    | UI polish, responsive mobile                |
| Seed data cho demo thực tế            | Demo script, slide trình bày               |
| Production config (env, secrets)      | Deploy thử nghiệm, smoke test              |

**Deliverable:** Hệ thống hoàn chỉnh, sẵn sàng demo.

---

## Quy tắc làm việc chung

- **Git flow:** `main` là nhánh ổn định. Feature branch đặt tên `feat/A-<tên>` hoặc `feat/B-<tên>`.
- **Commit convention:** `feat:`, `fix:`, `test:`, `docs:`, `refactor:`
- **Review:** Mỗi PR cần 1 người kia review trước khi merge.
- **Meeting:** 30 phút cuối mỗi tuần để sync, cập nhật kế hoạch.
- **Shared contracts:** `domain/types.ts` và `repository/interfaces.ts` là hợp đồng giữa hai người — thay đổi phải thảo luận trước.

---

## Mốc kiểm tra

| Mốc    | Tuần | Tiêu chí                                              |
|--------|------|-------------------------------------------------------|
| M1     | 2    | Domain types đầy đủ, hash-chain test pass             |
| M2     | 5    | Backend demo script chạy end-to-end                   |
| M3     | 7    | 21+ unit tests, API documented                        |
| M4     | 8    | PostgreSQL integration hoạt động                      |
| M5     | 11   | Frontend hoàn chỉnh, mọi route hoạt động             |
| M6     | 12   | Demo live, không có critical bug                      |
