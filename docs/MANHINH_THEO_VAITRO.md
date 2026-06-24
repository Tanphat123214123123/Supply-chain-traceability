# Đặc Tả Màn Hình Theo Vai Trò

## Tổng quan luồng màn hình

```
/login          ← Tất cả người dùng
    ↓ Đăng nhập thành công
/               ← Dashboard (danh sách lô hàng, filtered theo role)
    ├── /batch/:id        ← Chi tiết + timeline lô hàng
    ├── /record           ← Ghi sự kiện (khâu tương ứng role)
    └── /provenance/:id   ← Công khai, không cần đăng nhập (QR scan)
```

---

## 1. Màn hình Đăng nhập `/login`

**Tất cả vai trò**

| Element        | Chi tiết                                              |
|----------------|-------------------------------------------------------|
| Logo + tên     | 🔗 TraceChain, subtitle "Hệ thống truy xuất nguồn gốc" |
| Form           | Email, Password, nút "Đăng nhập"                     |
| Error          | Inline message dưới form nếu sai thông tin           |
| Demo hints     | Hiển thị 6 email demo và mật khẩu chung              |
| Redirect       | Sau login → `/` (Dashboard)                          |

---

## 2. Dashboard `/`

**Tất cả vai trò (đã đăng nhập)**

| Element           | Chi tiết                                                  |
|-------------------|-----------------------------------------------------------|
| Topbar            | Logo, tên người dùng + vai trò, nút Đăng xuất            |
| Search bar        | Tìm theo tên sản phẩm, xuất xứ, hoặc ID                  |
| Stats bar         | Tổng lô hàng · Đang hoạt động · Đã thu hồi               |
| Nút "+ Ghi sự kiện" | Dẫn đến `/record`                                      |
| Batch list        | Card mỗi lô: tên, loại, xuất xứ, số lượng, khâu hiện tại, ngày tạo |
| Recalled badge    | Thẻ đỏ "Thu hồi" trên lô đã bị thu hồi                  |
| Click vào lô      | Dẫn đến `/batch/:id`                                     |

**Lưu ý theo vai trò:**
- FARMER: thấy lô do mình tạo + tất cả lô
- ADMIN: thấy thêm nút "Thu hồi" trực tiếp từ danh sách

---

## 3. Chi tiết Lô hàng `/batch/:id`

**Tất cả vai trò (đã đăng nhập)**

| Element          | Chi tiết                                                   |
|------------------|------------------------------------------------------------|
| Header           | Tên sản phẩm, nút quay lại, VerifyBadge                   |
| Thông tin lô     | Loại, xuất xứ, số lượng, khâu hiện tại, ngày tạo, ID     |
| Recall banner    | Hiển thị nếu lô đã bị thu hồi, kèm lý do                 |
| Anomaly warnings | Danh sách cảnh báo bất thường (severity badge)            |
| Direction toggle | Thuận chiều ↓ / Ngược chiều ↑                             |
| Timeline         | Các sự kiện theo thứ tự, mỗi sự kiện có: khâu, địa điểm, thời gian, hash info |
| Nút ghi event    | "+ Ghi sự kiện mới" dẫn đến `/record?batchId=...`        |
| Public QR link   | URL `/provenance/:id` để chia sẻ cho người tiêu dùng     |

**Theo vai trò:**
- ADMIN: thêm nút "Thu hồi lô hàng" (mở modal nhập lý do)
- Tất cả: thấy đầy đủ hash chain, anomaly warnings

---

## 4. Ghi Sự Kiện `/record`

**Tất cả vai trò (đã đăng nhập)**

| Element         | Chi tiết                                                    |
|-----------------|-------------------------------------------------------------|
| Header          | Tiêu đề, nút quay lại                                      |
| Info banner     | Hiển thị tên người dùng + các khâu được phép theo role     |
| Select lô hàng  | Dropdown các lô chưa bị thu hồi                            |
| Select khâu     | Chỉ hiển thị khâu role được phép                           |
| Địa điểm        | Text input, bắt buộc                                       |
| Ghi chú         | Textarea, tuỳ chọn                                         |
| Error display   | Inline nếu backend từ chối (anomaly, unauthorized...)      |
| Redirect        | Sau ghi thành công → `/batch/:id`                         |

**Theo vai trò (khâu có sẵn):**

| Role         | Khâu có trong dropdown                    |
|--------------|-------------------------------------------|
| FARMER       | Thu hoạch                                 |
| PROCESSOR    | Chế biến, Đóng gói                        |
| INSPECTOR    | Kiểm định chất lượng                      |
| DISTRIBUTOR  | Phân phối                                 |
| RETAILER     | Bán lẻ                                    |
| ADMIN        | Tất cả 6 khâu                             |

---

## 5. Trang Nguồn Gốc Công Khai `/provenance/:batchId`

**Không cần đăng nhập — dành cho người tiêu dùng quét QR**

| Element           | Chi tiết                                                   |
|-------------------|------------------------------------------------------------|
| Header icon       | ✅ hoặc 🚨 tùy trạng thái                                 |
| Tên sản phẩm      | To, rõ ràng                                               |
| Chain valid badge | Xanh "Dữ liệu hợp lệ" hoặc đỏ "Có dấu hiệu bất thường"  |
| Recall banner     | Đỏ nổi bật nếu đã thu hồi + lý do                        |
| Thông tin sản phẩm| Xuất xứ, khâu hiện tại, số khâu đã hoàn thành            |
| Hành trình        | Danh sách 6 khâu: tick xanh (đã qua), số xám (chưa), highlight khâu hiện tại |
| Footer            | Batch ID + "Powered by TraceChain"                        |

**Thiết kế mobile-first** — người dùng chủ yếu xem trên điện thoại sau khi quét QR.

---

## 6. Component dùng lại

### Timeline
- Dòng thời gian dọc với icon khâu
- Mỗi node: tên khâu, địa điểm, thời gian, hash rút gọn
- Dùng ở: BatchDetail

### EventForm
- Form ghi sự kiện cấu hình theo role
- Props: `role`, `onSubmit`, `disabled`
- Dùng ở: RecordEvent, có thể nhúng vào BatchDetail

### VerifyBadge
- 3 trạng thái: "Đã xác thực" (xanh), "Có bất thường" (vàng), "Chuỗi bị can thiệp" (đỏ)
- Dùng ở: BatchDetail header, Provenance

### QRScanner
- Sử dụng BarcodeDetector API (Chrome/Android)
- Fallback manual input nếu không hỗ trợ
- Dùng ở: trang tìm kiếm, có thể thêm vào Provenance
