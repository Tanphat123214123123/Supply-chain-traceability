# TraceChain — Hệ thống Truy xuất Nguồn gốc Chuỗi Cung ứng

Hệ thống quản lý và truy xuất nguồn gốc sản phẩm trong chuỗi cung ứng, sử dụng **hash-chain ledger** (sổ cái chuỗi băm) để đảm bảo dữ liệu bất biến và có thể kiểm chứng. Cách lưu trữ, bảo mật dữ liệu và đặc tả hash: xem [docs/DATABASE.md](docs/DATABASE.md).

## Tính năng cốt lõi

- **Hash-chain bất biến, tự kiểm chứng được** — mỗi sự kiện được băm SHA-256 (JSON chuẩn hoá RFC 8785, có salt) nối với sự kiện trước; ai cũng tự tính lại được mà không cần khoá bí mật. Database tự chặn sửa/xoá sổ cái và kiểm tra liên kết khi ghi
- **Cách ly tenant bằng PostgreSQL** — row-level security + khoá ngoại theo tenant; API chạy bằng role quyền tối thiểu
- **RBAC** — 6 vai trò (Nông dân, Nhà chế biến, Kiểm định viên, Nhà phân phối, Nhà bán lẻ, Admin), mỗi vai trò chỉ ghi được khâu tương ứng
- **Truy xuất 2 chiều** — thuận chiều (từ nông trại → kệ hàng) và ngược chiều
- **Cảnh báo bất thường** — phát hiện ghi nhảy khâu, ghi trùng, ghi sai thứ tự
- **Thu hồi lô hàng** — block mọi sự kiện mới khi lô đã bị thu hồi
- **Trang công khai** — người tiêu dùng quét QR, xem nguồn gốc không cần đăng nhập

## Cấu trúc dự án

```
tracechain/
├── backend/                    # API + nghiệp vụ (Node.js + TypeScript)
│   ├── src/
│   │   ├── domain/types.ts     # Domain model
│   │   ├── db/                 # Kết nối, transaction theo tenant, migrator
│   │   ├── ledger/             # Hash-chain + chuẩn hoá JSON RFC 8785
│   │   ├── repository/         # Tầng lưu trữ PostgreSQL
│   │   ├── services/           # Business logic
│   │   └── api/                # HTTP routes + middleware
│   ├── tests/                  # Test trên PostgreSQL thật (Testcontainers)
│   └── migrations/             # SQL migration có đánh số, chạy bằng `npm run migrate`
├── frontend/                   # React 18 + Vite + Tailwind CSS
│   └── src/
│       ├── pages/              # Login, Dashboard, RecordEvent, BatchDetail, Provenance
│       ├── components/         # Timeline, EventForm, VerifyBadge, QRScanner
│       ├── context/            # AuthContext (JWT)
│       └── api/client.ts       # REST client + domain types
├── docs/                       # Tài liệu dự án
├── docker-compose.yml
└── .gitignore
```

## Chạy nhanh

### Cách nhanh nhất: Docker Compose (PostgreSQL + migrate + backend + frontend)

```bash
docker compose up --build
```

Mở http://localhost:5173 và đăng nhập bằng tài khoản demo bên dưới.

### Backend chạy ngoài Docker

Cần một PostgreSQL 16, ví dụ chỉ bật service `postgres`: `docker compose up -d postgres`. Service này mở ra máy bạn ở cổng **55432**, không dùng 5432 để tránh đụng PostgreSQL cài sẵn trên máy; đổi được bằng biến `POSTGRES_HOST_PORT`.

```bash
cd backend
npm install
cp .env.example .env  # điền JWT_SECRET
npm run migrate       # áp dụng migration bằng role chủ schema
npm run dev           # khởi động server trên :3000 (kết nối bằng role tracechain_app)
npm test              # cần Docker (Testcontainers) hoặc đặt TEST_DATABASE_URL
```

### Frontend

```bash
cd frontend
npm install
npm run dev           # Khởi động trên :5173 (proxy đến :3000)
```

## Tài khoản demo

| Email                   | Vai trò       | Mật khẩu  |
|-------------------------|---------------|-----------|
| farmer@demo.com         | Nông dân      | demo1234  |
| processor@demo.com      | Nhà chế biến  | demo1234  |
| inspector@demo.com      | Kiểm định     | demo1234  |
| distributor@demo.com    | Phân phối     | demo1234  |
| retailer@demo.com       | Bán lẻ        | demo1234  |
| admin@demo.com          | Admin         | demo1234  |

## Tài liệu

- [Cơ sở dữ liệu: migration, RLS, sổ cái, đặc tả hash, vận hành](docs/DATABASE.md)
- [Blueprint tổng quan](docs/README.md)
- [Kế hoạch 2 người](docs/KEHOACH_2NGUOI.md)
- [Đặc tả màn hình](docs/MANHINH_THEO_VAITRO.md)
- [Tính năng nâng cao](docs/TINHNANG_NANGCAO.md)
