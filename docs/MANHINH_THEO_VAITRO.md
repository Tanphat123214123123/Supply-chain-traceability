# Đặc Tả Màn Hình Theo Vai Trò

## Tổng quan luồng màn hình

```
/register        ← Tạo không gian mới (thành quản trị viên) hoặc nhập mã mời
/login           ← Tất cả người dùng
    ↓ Đăng nhập thành công
/dashboard       ← Việc đang chờ bạn · Cần chú ý · Tất cả lô hàng
    ├── /tasks            ← Việc cần làm (hộp việc — lối vào duy nhất để xử lý lô)
    │     └── /record?batchId=…  ← Xử lý lô: form đúng khâu tiếp theo
    ├── /batches/new      ← Tạo lô + ghi thu hoạch (Nông dân, Quản trị viên)
    ├── /batch/:id        ← Chi tiết, tiến độ, timeline, xuất báo cáo, thu hồi
    ├── /lots/transform   ← Gộp / tách / chế biến lô (Nhà chế biến, Nhà phân phối, Quản trị viên)
    ├── /plots            ← Vùng trồng: bản đồ, nhập GeoJSON/KML, thêm điểm < 4 ha
    └── /actors           ← Đối tác; Quản trị viên mời thành viên tại đây
/provenance/:id  ← Công khai, không cần đăng nhập (QR)
/verify?batch=…  ← Xác minh độc lập trên trình duyệt: tự tính mã băm, đối chiếu blockchain (`&token=` = link kiểm chứng đầy đủ)
```

---

## 1. Đăng ký `/register`

Không ai tự chọn vai trò.

| Tab                  | Chi tiết |
|----------------------|----------|
| Tôi có mã mời        | Nhập mã (hoặc mở link `/register?invite=MÃ`) → hiển thị "Bạn được mời vào *X* với vai trò *Y*" → họ tên, đơn vị, email (khoá nếu lời mời gắn email), mật khẩu |
| Tạo không gian mới   | Tên không gian, mã không gian (tự sinh từ tên), họ tên, đơn vị, email, mật khẩu → trở thành Quản trị viên, chuyển tới `/actors` để mời đối tác |

Đăng ký xong tự đăng nhập.

## 2. Đăng nhập `/login`

| Element    | Chi tiết |
|------------|----------|
| Form       | Email, mật khẩu |
| Lỗi        | Thông báo tiếng Việt ngay dưới form |
| Demo hints | Chỉ ở môi trường dev |

---

## 3. Tổng quan `/dashboard`

| Element                 | Chi tiết |
|-------------------------|----------|
| Nút chính               | Nông dân/Quản trị viên: "+ Lô hàng mới". Vai trò khác: "Việc cần làm (n)" |
| Đang chờ bạn xử lý      | Tối đa 3 lô kế tiếp của bạn, bấm vào là tới form xử lý (không hiện cho Quản trị viên) |
| Cần chú ý               | Quản trị viên + Kiểm định viên: lô đứng yên ≥ 3 ngày, số cảnh báo chưa xử lý |
| Thẻ số liệu             | Đang lưu thông · Chờ quá 3 ngày · Cảnh báo chưa xử lý · Đã thu hồi |
| Tất cả lô hàng          | Tìm kiếm + lọc theo khâu gần nhất; xem dạng danh sách hoặc theo khâu (mỗi cột tải tối đa 8 lô, có "Xem thêm") |
| Dòng lô hàng            | Tên, xuất xứ, số lượng, "Cập nhật … trước", trạng thái "Chờ <khâu>" (vàng nếu chờ ≥ 3 ngày) |

---

## 4. Việc cần làm `/tasks`

Các lô đã được bàn giao cho bạn, chờ lâu nhất lên đầu. Mỗi dòng: icon khâu, sản phẩm, đơn vị tạo lô, "Chờ từ …", nút tên khâu → `/record?batchId=…`. Số lượng hiện ở badge trên menu.

---

## 5. Xử lý lô `/record?batchId=…`

| Element            | Chi tiết |
|--------------------|----------|
| Thẻ lô             | Sản phẩm, số lượng, "khâu hiện tại → khâu tiếp theo" |
| Khâu               | Tự xác định (khâu kế tiếp). Quản trị viên có thể chọn khâu khác để bổ sung dữ liệu, kèm cảnh báo |
| Trường theo khâu   | Xem bảng dưới; trường có icon 🌐 sẽ hiện trên trang công khai |
| Địa điểm           | Tự điền: vùng trồng (thu hoạch) hoặc nơi bạn ghi lần trước cho khâu này |
| Ghi chú            | Chỉ nội bộ |
| Bàn giao cho       | Chỉ người có vai trò làm khâu sau; tự chọn nếu chỉ có một người |
| Không được phép    | Nếu lô không phải của bạn / đã thu hồi / đã hoàn tất: giải thích lý do thay vì form |
| Kiểm định "Không đạt" | Sau khi ghi, mở ngay hộp thoại thu hồi |

| Khâu                | Trường |
|---------------------|--------|
| Thu hoạch           | Ngày thu hoạch*, giống, tiêu chuẩn canh tác |
| Chế biến            | Phương pháp*, sản lượng sau chế biến, độ ẩm |
| Kiểm định chất lượng| Kết quả (Đạt/Không đạt)*, phân hạng, độ ẩm, số phiếu |
| Đóng gói            | Quy cách*, số kiện*, hạn sử dụng |
| Phân phối           | Nơi nhận*, phương tiện, nhiệt độ |
| Bán lẻ              | Cửa hàng*, ngày lên kệ |

Định nghĩa nằm ở `frontend/src/domain/stageFields.ts`; danh sách trường công khai được backend kiểm soát (`PUBLIC_EVENT_FIELDS`).

## 6. Lô hàng mới `/batches/new`

Nông dân, Quản trị viên. Một form: tên sản phẩm, loại (danh sách cố định), số lượng + đơn vị, vùng trồng (dùng làm xuất xứ và địa điểm thu hoạch), các trường thu hoạch, bàn giao cho nhà chế biến.

---

## 7. Chi tiết lô `/batch/:id`

| Element            | Chi tiết |
|--------------------|----------|
| Header             | Tên, VerifyBadge |
| Trạng thái         | Loại · xuất xứ · số lượng, thanh tiến độ 6 khâu, "Đang chờ <đơn vị> · từ …", nút "Xử lý: <khâu>" nếu đến lượt bạn |
| Cảnh báo           | Chỉ cảnh báo chưa xử lý |
| Xuất báo cáo       | Menu: Word .docx (Times New Roman 13, lề theo Nghị định 30/2020), Excel .xlsx (ô ngày/số đúng kiểu, cố định tiêu đề, bộ lọc). Cùng một nội dung, sinh từ `lib/reports/model.ts` |
| Timeline           | Mỗi khâu: đơn vị · người thực hiện, địa điểm, thông tin khâu, ghi chú; hash trong "Chi tiết kỹ thuật" |
| Tem truy xuất      | QR, sao chép link, mở trang công khai |
| Thu hồi            | Quản trị viên, Kiểm định viên: hộp thoại có lý do theo danh mục, chi tiết, xác nhận không thể hoàn tác |

---

## 8. Trang công khai `/provenance/:batchId`

Mobile-first, không cần đăng nhập.

| Element     | Chi tiết |
|-------------|----------|
| Trạng thái  | "Đã đến cửa hàng" / "Đang vận chuyển…" / "Đã thu hồi" |
| Thu hồi     | Banner đỏ, lý do, hướng dẫn "không sử dụng, mang trả nơi mua" |
| Hành trình  | Mỗi khâu: ngày, **đơn vị** (không lộ tên người), địa điểm, thông tin công khai |
| Toàn vẹn    | "Hồ sơ nguyên vẹn — chưa bị sửa hoặc xoá kể từ khi ghi; không thay thế kiểm định độc lập", link tự kiểm chứng |

---

## 9. Báo cáo `/reports`

Xuất danh sách lô hàng ra Excel .xlsx theo khoảng ngày (tính trọn ngày theo giờ địa phương) và xuất xứ; sheet "Thông tin xuất" ghi lại bộ lọc đã dùng.

---

## 10. Đối tác `/actors`

Tất cả: danh sách tổ chức và tài khoản. Quản trị viên: mời thành viên (vai trò, hiệu lực, email tuỳ chọn, ghi chú) → mã hiển thị một lần + link đăng ký; danh sách lời mời (đang chờ / đã dùng / hết hạn / đã huỷ), huỷ lời mời; khoá/mở khoá tài khoản.

---

## 11. Component dùng lại

| Component          | Dùng ở |
|--------------------|--------|
| `StageFieldsInput` | Form xử lý lô, lô mới |
| `HandoffSelect`    | Form xử lý lô, lô mới |
| `Timeline`         | Chi tiết lô |
| `RecallDialog` + `ui/Modal` | Chi tiết lô |
| `BatchRow`         | Tổng quan |
| `InvitePanel`      | Đối tác (Quản trị viên) |
| `VerifyBadge`      | Chi tiết lô — "Dữ liệu nguyên vẹn" / "Có bất thường" / "Chuỗi bị can thiệp" |
| `QRScanner`        | `/scan` |

---

## 12. Màn hình giai đoạn 1

| Màn hình | Nội dung chính |
|---|---|
| `/lots/transform` | Chọn loại (gộp / tách / chế biến), chọn lô đầu vào đang giữ kèm số lượng còn lại, khai báo lô đầu ra; ước tính cân bằng khối lượng trực tiếp; giữ lại hoặc giao cho người làm cùng khâu / khâu kế |
| `/plots` | Bản đồ OpenStreetMap các lô đất; nhập tệp GeoJSON/KML (ranh giới); bấm bản đồ để thêm lô dưới 4 ha dạng điểm; bảng mã, tên, diện tích |
| Chi tiết lô — *Phả hệ lô hàng* | Lô nguồn, lô đã tạo ra, phần đã chuyển; tải GeoJSON vùng trồng (EUDR) |
| Chi tiết lô — *Bàn giao lô* | Khi đang giữ lô nhưng khâu kế do người khác làm |
| Chi tiết lô — *Kiểm chứng độc lập* | Mở trang xác minh; tạo link kiểm chứng đầy đủ 1–30 ngày cho kiểm toán viên |
| `/verify` | Kết luận *Đã xác minh / Chưa đóng dấu đủ / Phát hiện sai lệch*; mỗi sự kiện: nội dung khớp, liên kết chuỗi, đã neo (thời điểm, khối); địa chỉ hợp đồng; "Kiểm tra lại" không gọi máy chủ |
| Trang công khai — *Nguồn gốc* | Số lô thu hoạch, số lô đất, vùng trồng, đơn vị sản xuất (không lộ tên cá nhân) |

