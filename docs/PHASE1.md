# Giai đoạn 1 — Mô hình chuỗi cung ứng thực tế và neo blockchain

Tài liệu này mô tả những gì giai đoạn 1 đã làm, cách chạy, cách kiểm chứng và các giới hạn.
Đặc tả kỹ thuật chính xác (hash, Merkle, hợp đồng, dữ liệu) nằm ở [SPEC_PHASE1.md](SPEC_PHASE1.md).

## 1. Kết quả theo gói công việc

| Gói | Nội dung | Mã nguồn chính | Kiểm thử |
|---|---|---|---|
| WP0 | Trang kiểm chứng công khai không còn trả `actorId`, `notes`, trường nội bộ; link kiểm chứng đầy đủ có hạn | `services/traceService.ts` | `traceService.test.ts`, `api.integration.test.ts` |
| WP1 | Đặc tả hash v3 (tiết lộ chọn lọc), sự kiện nhiều đầu vào, cây Merkle, mô hình dữ liệu; bộ test vector | `docs/SPEC_PHASE1.md`, `ledger/hashChain.ts`, `ledger/merkle.ts` | `ledgerPhase1.test.ts`, `frontend/src/lib/verify/verify.test.ts` |
| WP2 | Hợp đồng `TraceAnchor`; worker neo có outbox, khoá, thử lại, phục hồi; neo bù dữ liệu cũ (worker tự lấy mọi sự kiện chưa neo) | `contracts/`, `backend/src/anchor/` | `contracts/test` (100% coverage), `anchorWorker.test.ts`, `anchorChain.integration.test.ts` |
| WP3 | Trang `/verify` tự tính hash, dựng Merkle root, đọc hợp đồng qua RPC công khai | `frontend/src/lib/verify/`, `pages/ChainVerifier.tsx` | `verify.test.ts` |
| WP4 | Gộp / tách / biến đổi lô; đồ thị phả hệ; quyền giữ hàng theo lô; bàn giao lô không cần ghi khâu | `services/lineageService.ts`, `pages/TransformLots.tsx`, `components/LineagePanel.tsx` | `lineage.test.ts` |
| WP5 | Vùng trồng PostGIS, nhập GeoJSON/KML, bản đồ, xuất GeoJSON theo lô | `services/plotService.ts`, `pages/Plots.tsx` | `lineage.test.ts` (PlotService), `importFile.test.ts` |
| WP6 | Cân bằng khối lượng mức 1 (biến đổi) và mức 2 (lô đất) | `lineageService.ts`, `supplyChainService.ts` | `lineage.test.ts`, `fraudScenarios.test.ts` |
| WP7 | Kịch bản gian lận end-to-end, tài liệu | `tests/fraudScenarios.test.ts` | — |

### Tiêu chí hoàn thành

- [x] Quét QR → trình duyệt tự xác minh với hợp đồng, không cần tin máy chủ (chặn API sau khi tải dữ liệu, kết quả không đổi).
- [x] Sửa một bản ghi trong database → trang xác minh báo sai lệch.
- [x] Từ một container truy ngược đủ danh sách lô đất kèm GeoJSON (200 hộ, < 500 ms).
- [x] Khai khống sản lượng → cảnh báo cân bằng khối lượng.
- [x] Endpoint công khai không trả bất kỳ trường nội bộ nào.
- [ ] Deploy lên testnet công khai — cần ví có token testnet của nhóm (mục 4).

## 2. Chạy cục bộ

```bash
docker compose up --build
```

| Service | Vai trò |
|---|---|
| `postgres` | PostgreSQL 16 + PostGIS |
| `migrate` | Chạy migration 001–014 |
| `anvil` | Chuỗi EVM cục bộ (chain id 31337, cổng 8545, trạng thái lưu trong volume `anvil_data`) |
| `anchor-deploy` | Deploy `TraceAnchor` một lần tới địa chỉ cố định `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| `backend` | API + worker neo (mỗi 15 giây khi có sự kiện mới) |
| `frontend` | Giao diện; trang `/verify` đọc thẳng `http://localhost:8545` |

Khoá riêng trong `docker-compose.yml` là **khoá dev công khai của anvil** — chỉ dùng cho chuỗi cục bộ.

Chạy neo ngay thay vì chờ chu kỳ (tài khoản ADMIN): `POST /api/admin/anchors/run`. Trạng thái các mẻ: `GET /api/admin/anchors`.

## 3. Kịch bản demo gian lận

1. Đăng nhập, tạo lô, ghi vài khâu; đợi worker neo (hoặc gọi `/api/admin/anchors/run`).
2. Mở `/verify?batch=<mã lô>` → "Đã xác minh trên blockchain".
3. Vào database, sửa một giá trị (ví dụ kết quả kiểm định) → tải lại `/verify` → "Phát hiện sai lệch".
4. Kẻ có toàn quyền DB tính lại cả chuỗi, head lẫn cây Merkle cho khớp → mọi kiểm tra nội bộ đều "hợp lệ", nhưng `/verify` báo root **không có trên hợp đồng**. Test `fraudScenarios.test.ts` tự động hoá đúng kịch bản này.
5. Chế biến 1 tấn quả tươi ra 600 kg nhân xanh → cảnh báo "Sai lệch khối lượng".

## 4. Triển khai lên testnet

Chọn một L2 testnet (Base Sepolia, Arbitrum Sepolia hoặc Polygon Amoy) và một ví **chỉ dùng cho testnet**.

```bash
cd contracts
npm ci
ANCHOR_DEPLOYER_KEY=0x... ANCHOR_WORKER_ADDRESS=0x<ví worker> \
  npx hardhat run scripts/deploy.ts --network baseSepolia
ETHERSCAN_API_KEY=... npx hardhat verify --network baseSepolia <địa chỉ>   # công khai mã nguồn
```

Cấu hình:

| Nơi | Biến |
|---|---|
| Backend | `ANCHOR_RPC_URL` (nhiều URL, phân tách bằng dấu phẩy), `ANCHOR_CHAIN_ID`, `ANCHOR_CONTRACT`, `ANCHOR_PRIVATE_KEY` (ví worker), `ANCHOR_CONFIRMATIONS` (khuyến nghị 2–3) |
| Frontend (lúc build) | `VITE_ANCHOR_CHAIN_ID`, `VITE_ANCHOR_CONTRACT`, `VITE_ANCHOR_RPC_URLS`, `VITE_ANCHOR_EXPLORER_URL` (ví dụ `https://sepolia.basescan.org`) |

Địa chỉ hợp đồng được **build cố định vào frontend**, không lấy từ API, để máy chủ bị chiếm quyền cũng không trỏ được người kiểm chứng sang hợp đồng khác. Trang `/verify` hiển thị địa chỉ này để ai cũng so được với địa chỉ nhóm công bố.

## 5. Giới hạn

- Blockchain chứng minh dữ liệu **không bị sửa kể từ lúc neo**, không chứng minh dữ liệu **đúng khi nhập**. Cân bằng khối lượng chỉ phát hiện số liệu vô lý.
- Có độ trễ giữa lúc ghi và lúc neo (chu kỳ worker + số khối xác nhận); trong khoảng đó sự kiện hiện "chờ neo".
- Máy chủ vẫn có thể **không ghi** hoặc **chậm neo** một sự kiện. Chữ ký số của từng bên (giai đoạn 2) và biên nhận đã ký sẽ thu hẹp lỗ hổng này.
- Sự kiện v1 (HMAC) và v2 cũ được neo, nhưng nội dung v2 chỉ kiểm được qua link kiểm chứng đầy đủ.
- Khung toạ độ Việt Nam là hình chữ nhật xấp xỉ. Chưa đối chiếu bản đồ phá rừng.
- Link kiểm chứng là token mang theo (bearer): ai có link thì xem được mọi trường đến khi hết hạn; chưa thu hồi sớm được.
