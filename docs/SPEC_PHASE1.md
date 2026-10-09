# Đặc tả kỹ thuật — Giai đoạn 1

Tài liệu này là **hợp đồng** giữa máy chủ TraceChain và mọi bên kiểm chứng độc lập
(trình duyệt, kiểm toán viên, bên mua). Bất kỳ ai làm đúng các bước dưới đây, bằng
bất kỳ ngôn ngữ nào, phải ra đúng các mã băm và Merkle root mà TraceChain công bố.
Bộ test vector ở [`docs/test-vectors/phase1.json`](test-vectors/phase1.json) được
kiểm tra tự động ở cả backend lẫn frontend, nên đặc tả và mã nguồn không thể lệch nhau.

Ký hiệu:

- `SHA256(x)` — SHA-256 của chuỗi byte `x`; `hex(·)` — 64 ký tự hex chữ thường.
- `JCS(v)` — JSON chuẩn hoá theo **RFC 8785** (khoá sắp theo UTF-16, số dạng ngắn nhất
  ECMAScript, không khoảng trắng), mã hoá UTF-8.
- `‖` — nối chuỗi byte.

---

## 1. Mã băm sự kiện

Mỗi sự kiện mang `hashVersion`. Phiên bản cũ được giữ nguyên mãi mãi — không bao giờ
tính lại hash của dữ liệu đã ghi.

| Phiên bản | Cách tính | Kiểm chứng công khai |
|---|---|---|
| v1 | HMAC-SHA256 với khoá bí mật của máy chủ | Không (chỉ máy chủ) |
| v2 | `SHA256(JCS(toàn bộ sự kiện + salt))` | Có, nhưng phải công bố **toàn bộ** nội dung |
| **v3** | Cam kết theo từng trường (mục 1.1) | Có, **tiết lộ chọn lọc** từng trường |

Sự kiện mới từ giai đoạn 1 dùng **v3**.

### 1.1. Hash v3 — tiết lộ chọn lọc

Một sự kiện gồm **phần khung** (luôn công khai) và các **trường cam kết** (claim).

**Phần khung** — không chứa thông tin kinh doanh nhạy cảm:

| Khoá | Kiểu | Ý nghĩa |
|---|---|---|
| `v` | số `3` | phiên bản |
| `batchId` | chuỗi UUID | lô chứa sự kiện |
| `sequenceNumber` | số nguyên ≥ 0 | thứ tự trong chuỗi của lô |
| `prevHash` | hex 64 | hash sự kiện trước (sự kiện đầu: 64 số `0`) |
| `stage` | chuỗi | `HARVEST` … `RETAIL` |
| `kind` | chuỗi | `OBSERVE`, `MERGE`, `SPLIT`, `TRANSFORM` (mục 3) |
| `timestamp` | chuỗi ISO 8601 UTC, mili-giây | thời điểm ghi |
| `links` | mảng | lô đầu vào (mục 1.2); `[]` với `OBSERVE` |
| `claims` | mảng hex 64, **sắp tăng dần** | cam kết của từng trường |

**Trường cam kết.** Mỗi trường có tên, giá trị và một salt ngẫu nhiên 32 byte riêng:

```
tên trường:   "actorId" | "location" | "notes" | "data.<khoá>"
commitment  = hex(SHA256(JCS({ "name": tên, "salt": salt_hex, "value": giá_trị })))
```

Chỉ các trường **có giá trị** mới có cam kết (`notes` rỗng thì không có).

**Hash sự kiện:**

```
eventHash = hex(SHA256(JCS({ v, batchId, sequenceNumber, prevHash, stage, kind, timestamp, links, claims })))
```

`claims` được sắp tăng dần nên thứ tự không làm lộ trường nào ứng với cam kết nào;
người ngoài chỉ biết **có bao nhiêu** trường bị ẩn.

**Tiết lộ.** Để công bố một trường, máy chủ đưa `{name, value, salt}`; trường không công
bố chỉ đưa `commitment`. Người kiểm chứng:

1. tính lại commitment của mọi trường được tiết lộ;
2. gộp với các commitment ẩn, sắp tăng dần;
3. tính `eventHash` theo công thức trên và so với hash đã neo (mục 2).

Khớp nghĩa là: các giá trị được tiết lộ **đúng là** của sự kiện đã neo, và không trường
nào bị thêm, bớt hay sửa. Salt 256 bit khiến không thể dò ngược giá trị ẩn từ commitment,
kể cả với giá trị ít khả năng như "Đạt/Không đạt".

**Trường được công bố trên trang công khai** — mọi trường khác chỉ hiện commitment:

| Khâu | Trường công khai |
|---|---|
| Mọi khâu | `location` |
| HARVEST | `data.harvestDate`, `data.variety`, `data.cultivation` |
| PROCESSING | `data.method` |
| QUALITY_CHECK | `data.result`, `data.grade`, `data.certificateNo` |
| PACKAGING | `data.packageType`, `data.expiryDate` |
| DISTRIBUTION | `data.destination` |
| RETAIL | `data.storeName`, `data.shelfDate` |

`actorId`, `notes` và mọi trường khác **không bao giờ** công khai. Tên đơn vị trên trang
công khai lấy từ hồ sơ tổ chức, không nằm trong hash.

### 1.2. Sự kiện nhiều đầu vào

Sự kiện đầu tiên của một lô sinh ra từ gộp/tách/biến đổi mang `links` — mỗi phần tử ứng
với một lô đầu vào, **sắp theo `lotId`**:

```json
{ "lotId": "<uuid>", "quantity": 120.5, "unit": "kg", "headHash": "<hex64>", "eventCount": 3 }
```

`headHash`/`eventCount` là đầu chuỗi của lô đầu vào **tại thời điểm** bị tiêu thụ. Vì
`links` nằm trong hash, toàn vẹn lan qua cả đồ thị: sửa hoặc cắt chuỗi của một lô thượng
nguồn sẽ không còn khớp với `headHash` mà các lô hạ nguồn đã cam kết.

Kiểm tra một liên kết: sự kiện thứ `eventCount − 1` của lô đầu vào phải có hash bằng
`headHash`.

---

## 2. Neo Merkle root lên blockchain

### 2.1. Cây Merkle

Theo cấu trúc của **RFC 9162** (Certificate Transparency v2), với tiền tố phân biệt lá
và nút trong để chống tấn công second-preimage:

```
leafHash(e)     = SHA256(0x00 ‖ bytes32(eventHash))
nodeHash(L, R)  = SHA256(0x01 ‖ L ‖ R)

MTH([])         — không dùng (mẻ neo luôn có ≥ 1 lá)
MTH([d0])       = leafHash(d0)
MTH(D[0..n))    = nodeHash(MTH(D[0..k)), MTH(D[k..n)))   với k = luỹ thừa 2 lớn nhất < n
```

Lá được xếp theo `(timestamp, eventId)` của sự kiện; vị trí lá (`leafIndex`) được lưu
cùng bằng chứng.

### 2.2. Bằng chứng (inclusion proof)

Bằng chứng là danh sách hash anh em từ lá lên gốc, theo thuật toán sinh và kiểm tra của
RFC 9162 §2.1.3. Kiểm tra (`leafIndex`, `treeSize`, `proof[]`, `root`):

```
fn = leafIndex; sn = treeSize − 1; r = leafHash(eventHash)
với mỗi p trong proof:
    nếu sn == 0: thất bại
    nếu fn lẻ hoặc fn == sn:
        r = nodeHash(p, r)
        nếu fn chẵn: lặp { fn >>= 1; sn >>= 1 } cho tới khi fn lẻ hoặc fn == 0
    ngược lại:
        r = nodeHash(r, p)
    fn >>= 1; sn >>= 1
thành công khi sn == 0 và r == root
```

### 2.3. Hợp đồng `TraceAnchor`

| Hàm | Ý nghĩa |
|---|---|
| `anchor(bytes32 root, uint32 leafCount)` | Chỉ ví được cấp quyền gọi. Từ chối root rỗng, `leafCount = 0`, hoặc root đã neo (`AlreadyAnchored`) — nên gửi lại giao dịch là an toàn |
| `anchoredAt(bytes32 root) → uint64` | Thời điểm khối chứa giao dịch neo; `0` = chưa neo |
| `anchoredBlock(bytes32 root) → uint64` | Số khối |
| `anchorCount() → uint256` | Tổng số mẻ đã neo |
| sự kiện `Anchored(id, root, leafCount, timestamp)` | Nhật ký công khai |

Hợp đồng **không** lưu dữ liệu sản phẩm, không có token, không có logic nghiệp vụ.

### 2.4. Quy trình của worker

Bảng `anchors` theo dõi mỗi mẻ: `built → submitted → confirmed`.

1. Chỉ một mẻ được xử lý tại một thời điểm (advisory lock trong PostgreSQL).
2. **Dựng mẻ** — trong *một* giao dịch database: lấy các sự kiện chưa neo của mọi tenant,
   dựng cây, ghi `anchors` (trạng thái `built`) và `anchor_leaves` (vị trí lá + bằng chứng).
   Sự kiện đã thuộc một mẻ không bao giờ bị lấy lại → không trùng, không sót.
3. **Gửi** — gọi `anchor(root, n)`, lưu `tx_hash`, chuyển `submitted`.
4. **Xác nhận** — đợi đủ số khối xác nhận, lưu số khối và thời điểm, chuyển `confirmed`.
5. **Phục hồi** — khởi động lại ở bất kỳ bước nào: nếu `anchoredAt(root) ≠ 0` thì coi như
   đã neo; nếu chưa thì gửi lại (hợp đồng chặn neo trùng).

---

## 3. Mô hình lô và đồ thị phả hệ

Bảng `batches` giữ vai trò **lô** (lot). Quan hệ giữa các lô ghi trong bảng
`transformations` — tương đương *Transformation/Aggregation Event* của **GS1 EPCIS 2.0**:

| Loại | Đầu vào | Đầu ra | Ràng buộc |
|---|---|---|---|
| `MERGE` (gộp) | ≥ 2 lô | 1 lô | cùng loại hàng |
| `SPLIT` (tách) | 1 lô | ≥ 2 lô | cùng loại hàng |
| `TRANSFORM` (biến đổi) | ≥ 1 lô | ≥ 1 lô | loại hàng có thể đổi, kiểm cân bằng theo hệ số |

```
transformations(id, tenant_id, kind, stage, actor_id, location, notes, created_at)
transformation_inputs(transformation_id, lot_id, quantity, unit, head_hash, event_count)
transformation_outputs(transformation_id, lot_id)          -- mỗi lô là đầu ra của tối đa 1 biến đổi
batches.consumed_quantity                                   -- CHECK consumed_quantity <= quantity
```

- Mỗi lô đầu ra có sự kiện đầu tiên `kind = MERGE|SPLIT|TRANSFORM`, `links` như mục 1.2.
- Lô đầu vào bị trừ `consumed_quantity`; tiêu thụ hết thì không ghi thêm sự kiện được
  (kiểm tra cả ở ứng dụng lẫn trigger sổ cái).
- Truy ngược/xuôi bằng `WITH RECURSIVE`, giới hạn độ sâu 32.

## 4. Vùng trồng và lô đất

```
plots(id, tenant_id, code, name, owner_actor_id, geom geometry(MultiPolygon,4326),
      point geometry(Point,4326), area_ha, created_at)
batches.plot_id                                             -- lô thu hoạch gắn với một lô đất
```

- Hệ toạ độ WGS84 (EPSG:4326), đúng định dạng GeoJSON mà EUDR yêu cầu.
- Diện tích: `ST_Area(geom::geography) / 10000` (ha). Tính trên `geometry` sẽ ra "độ vuông".
- Lô < 4 ha được lưu **một điểm** kèm diện tích khai báo; lô ≥ 4 ha **bắt buộc đa giác**.
- Từ chối: hình không hợp lệ (`ST_IsValid`), nằm ngoài lãnh thổ Việt Nam (khung
  102.1–109.5°E, 8.4–23.4°N), chồng lấn lô khác trong cùng tenant quá 100 m².
- Xuất GeoJSON với 6 chữ số thập phân (`ST_AsGeoJSON(geom, 6)`).

## 5. Cân bằng khối lượng

Khối lượng được quy về kg (`kg` × 1, `tấn` × 1000; đơn vị đếm như `bao`, `thùng` không
quy đổi được → bỏ qua kiểm tra và ghi chú).

**Mức 1 — từng biến đổi.** `Σ đầu ra ≤ Σ đầu vào × max_ratio`.
`MERGE`/`SPLIT`: `max_ratio = 1` (cho phép hao hụt, không cho phép tăng).
`TRANSFORM`: tra bảng `conversion_factors(from_type, to_type, min_ratio, max_ratio)`.

**Mức 2 — theo lô đất.** Tổng khối lượng thu hoạch của một lô đất trong 365 ngày
`≤ diện tích × yield_caps.max_kg_per_ha` của loại hàng đó.

Vi phạm sinh cảnh báo `MASS_BALANCE_VIOLATION` (mức HIGH). Riêng việc tiêu thụ quá
lượng còn lại của lô đầu vào là **bất khả thi về vật lý** nên bị từ chối ngay.

| Từ → đến | Tỉ lệ |
|---|---|
| Cà phê quả tươi → Cà phê nhân xanh | 0,16 – 0,22 |
| Cà phê quả tươi → Cà phê nhân xô | 0,40 – 0,50 |
| Cà phê nhân xô → Cà phê nhân xanh | 0,78 – 0,85 |
| Cà phê nhân xanh → Cà phê rang | 0,80 – 0,88 |
| Mủ cao su nước → Cao su khối | 0,28 – 0,40 |

| Loại hàng | Năng suất trần (kg/ha/năm) |
|---|---|
| Cà phê quả tươi | 30 000 |
| Cà phê nhân xanh | 6 000 |
| Mủ cao su nước | 6 000 |

Cân bằng khối lượng **phát hiện số liệu vô lý**, không chứng minh hàng là thật.

## 6. Quyền xem dữ liệu khi kiểm chứng

| Cấp | Ai | Nhận được |
|---|---|---|
| Công khai | Bất kỳ ai có mã lô (QR) | Phần khung, trường công khai + salt, commitment của trường ẩn, bằng chứng neo. Sự kiện v1/v2: chỉ hash và liên kết |
| Đầy đủ | Người có **link kiểm chứng** (token ký, có hạn 1–30 ngày, do thành viên tenant tạo) | Toàn bộ trường + salt — tính lại được 100% |

Endpoint công khai **không bao giờ** trả `actorId`, `notes`, `tenantId` hay trường
`data` ngoài danh sách công khai.
