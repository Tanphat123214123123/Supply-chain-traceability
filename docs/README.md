# TraceChain — Blueprint Tổng Quan

## Mô tả hệ thống

TraceChain là hệ thống truy xuất nguồn gốc sản phẩm trong chuỗi cung ứng, sử dụng **hash-chain ledger** (sổ cái chuỗi băm) để đảm bảo dữ liệu bất biến và có thể kiểm chứng — tương tự blockchain nhưng gọn nhẹ, phù hợp cho môi trường SME và hệ thống permissioned.

---

## Kiến trúc tổng thể

```
┌─────────────────┐     REST/JSON      ┌──────────────────────┐
│   Frontend      │ ◄────────────────► │   Backend (Express)  │
│   React + Vite  │                    │   TypeScript         │
│   Tailwind CSS  │                    │                      │
└─────────────────┘                    ├──────────────────────┤
                                       │   Service Layer       │
                                       │  SupplyChainService  │
                                       │  AnomalyDetector     │
                                       │  AuthService (JWT)   │
                                       ├──────────────────────┤
                                       │   Hash-Chain Ledger  │
                                       │   SHA-256 per event  │
                                       ├──────────────────────┤
                                       │   Repository Layer   │
                                       │  PostgreSQL 16 (RLS) │
                                       └──────────────────────┘
```

---

## Domain Model

### Actor (Vai trò người dùng)

| Role         | Tên             | Khâu được phép                  |
|--------------|-----------------|----------------------------------|
| FARMER       | Nông dân        | HARVEST                          |
| PROCESSOR    | Nhà chế biến    | PROCESSING, PACKAGING            |
| INSPECTOR    | Kiểm định viên  | QUALITY_CHECK                    |
| DISTRIBUTOR  | Nhà phân phối   | DISTRIBUTION                     |
| RETAILER     | Nhà bán lẻ      | RETAIL                           |
| ADMIN        | Quản trị viên   | Tất cả                           |

### Supply Chain Stages (Thứ tự bắt buộc)

```
HARVEST → PROCESSING → QUALITY_CHECK → PACKAGING → DISTRIBUTION → RETAIL
```

### Hash-Chain Ledger

Mỗi sự kiện (TraceEvent) chứa:
- `hash`: SHA-256 của toàn bộ dữ liệu event + prevHash
- `prevHash`: hash của event trước (event đầu tiên dùng GENESIS_HASH)
- `sequenceNumber`: số thứ tự tăng dần

Bất kỳ sửa đổi nào vào dữ liệu sẽ phá vỡ chuỗi và bị phát hiện ngay khi `verifyChain()` chạy.

---

## API Endpoints

### Auth
| Method | Endpoint           | Mô tả                    |
|--------|--------------------|--------------------------|
| POST   | /api/auth/login    | Đăng nhập, nhận JWT      |
| POST   | /api/auth/register | Đăng ký: `mode: "workspace"` (tạo không gian mới, thành quản trị viên) hoặc `mode: "invite"` (dùng mã mời, vai trò theo lời mời) |
| GET    | /api/auth/invitations/:code | Xem trước lời mời (tên không gian, vai trò) — công khai |

### Admin — lời mời
| Method | Endpoint                    | Mô tả                                        |
|--------|-----------------------------|----------------------------------------------|
| GET    | /api/admin/invitations      | Lời mời gần đây                              |
| POST   | /api/admin/invitations      | Tạo mã mời (`role`, `email?`, `expiresInDays`) — mã chỉ trả về một lần |
| DELETE | /api/admin/invitations/:id  | Huỷ lời mời chưa dùng                        |

### Batches
| Method | Endpoint                  | Mô tả               |
|--------|---------------------------|---------------------|
| POST   | /api/batches              | Tạo lô hàng mới     |
| GET    | /api/batches              | Danh sách lô hàng (`search`, `stage` = khâu hoặc `NONE`) |
| GET    | /api/batches/pending      | Lô đang chờ chính người gọi xử lý |
| GET    | /api/batches/:id          | Chi tiết lô hàng    |
| POST   | /api/batches/:id/recall   | Thu hồi lô hàng     |

### Events
| Method | Endpoint     | Mô tả                        |
|--------|--------------|------------------------------|
| POST   | /api/events  | Ghi sự kiện chuỗi cung ứng; `data` chứa thông tin riêng của khâu (phẳng, tối đa 30 trường) |

### Stats
| Method | Endpoint              | Mô tả                                              |
|--------|-----------------------|----------------------------------------------------|
| GET    | /api/stats/overview   | Tổng quan (gồm `openAnomalyCount`)                 |
| GET    | /api/stats/attention  | Lô đứng yên từ 3 ngày + số cảnh báo chưa xử lý     |

### Trace
| Method | Endpoint                      | Mô tả                          |
|--------|-------------------------------|--------------------------------|
| GET    | /api/trace/:batchId           | Truy xuất (có auth)            |
| GET    | /api/trace/:batchId?direction=backward | Truy xuất ngược chiều |
| GET    | /api/trace/public/:batchId    | Truy xuất công khai (QR scan): hành trình theo đơn vị, chỉ các trường được phép công khai |

---

## Anomaly Detection

| Loại              | Severity | Mô tả                                     |
|-------------------|----------|-------------------------------------------|
| STAGE_OUT_OF_ORDER | HIGH    | Ghi khâu đã qua (đi ngược thứ tự)        |
| DUPLICATE_STAGE   | MEDIUM   | Ghi lại khâu đã có                        |
| UNAUTHORIZED_STAGE | HIGH    | Role không được phép ghi khâu này         |
| BATCH_RECALLED    | CRITICAL | Lô hàng đã bị thu hồi                    |
| HASH_TAMPERED     | CRITICAL | Dữ liệu bị sửa đổi                       |

Mức CRITICAL và HIGH **chặn** hành động. MEDIUM và LOW chỉ **cảnh báo**.

---

## Stack công nghệ

| Layer     | Công nghệ                                    |
|-----------|----------------------------------------------|
| Backend   | Node.js 20, TypeScript 5, Express 4          |
| Crypto    | Node.js `crypto` (SHA-256 built-in)          |
| Auth      | JWT (`jsonwebtoken`), bcrypt (`bcryptjs`)    |
| DB        | PostgreSQL 16 — xem [DATABASE.md](DATABASE.md) |
| Frontend  | React 18, Vite 5, Tailwind CSS 3             |
| Router    | React Router v6                              |
| HTTP      | Axios                                        |
| Container | Docker Compose                               |
| Testing   | Jest 29 + ts-jest                            |
