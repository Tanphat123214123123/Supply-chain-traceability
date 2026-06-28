# TraceChain — Hệ thống Truy xuất Nguồn gốc Chuỗi Cung ứng

Hệ thống quản lý và truy xuất nguồn gốc sản phẩm trong chuỗi cung ứng, sử dụng **hash-chain ledger** (sổ cái chuỗi băm) để đảm bảo dữ liệu bất biến và có thể kiểm chứng.

## Tính năng cốt lõi

- **Hash-chain bất biến** — mỗi sự kiện được ký SHA-256 liên kết với sự kiện trước, phát hiện ngay bất kỳ sửa đổi nào
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
│   │   ├── ledger/hashChain.ts # Hash-chain core
│   │   ├── repository/         # Tầng lưu trữ (InMemory + PostgreSQL stubs)
│   │   ├── services/           # Business logic
│   │   └── api/                # HTTP routes + middleware
│   ├── tests/                  # 21 unit tests
│   └── migrations/             # SQL schema
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

### Backend (demo mode — in-memory)

```bash
cd backend
npm install
npm run demo          # Demo end-to-end với dữ liệu mẫu

npm run dev           # Khởi động server trên :3000
npm test              # Chạy 21 unit tests
```

### Frontend

```bash
cd frontend
npm install
npm run dev           # Khởi động trên :5173 (proxy đến :3000)
```

### Docker Compose (PostgreSQL + backend + frontend)

```bash
docker compose up
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

- [Blueprint tổng quan](docs/README.md)
- [Kế hoạch 2 người](docs/KEHOACH_2NGUOI.md)
- [Đặc tả màn hình](docs/MANHINH_THEO_VAITRO.md)
- [Tính năng nâng cao](docs/TINHNANG_NANGCAO.md)
