# ASSIGNMENT SPECIFICATION: SCHEDULE TASK APPLICATION

| Mục | Nội dung |
| :--- | :--- |
| **Tên assignment** | Schedule Task Application |
| **Bối cảnh** | Xây dựng ứng dụng cho phép tạo và chạy các tác vụ theo lịch (schedule), phục vụ automation nội bộ. |
| **Mục tiêu** | Thiết kế một hệ thống có thể nhận lịch chạy, xử lý task đúng giờ, theo dõi trạng thái, và đảm bảo không chạy trùng. |
| **Thời lượng gợi ý** | 2 tuần |

---

## 🎯 Tổng Quan Chức Năng Hệ Thống

Xây dựng một ứng dụng **Schedule Task** có khả năng:

1. **Tạo task theo lịch:** Hỗ trợ cấu hình chạy một lần (`scheduleAt`) hoặc lặp lại (`cronExpr`).
2. **Hỗ trợ đa dạng loại tác vụ (Task Types):**
   * 📁 **Đọc file:** Đọc nội dung file từ đường dẫn hợp lệ.
   * 📥 **Import files:** Nhận nhiều file cùng lúc, thực hiện parse và lưu dữ liệu.
   * 📝 **Điền thông tin:** Điền dữ liệu tự động theo template/form data (JSON).
   * 📧 **Gửi email:** Tự động gửi email theo lịch cấu hình sẵn.
3. **Tích hợp bên ngoài:** Cung cấp cổng tiếp nhận (API endpoint hoặc Queue endpoint) để push schedule task từ các hệ thống ngoại vi.
4. **Quản lý vòng đời tác vụ:** Theo dõi và cập nhật trạng thái trực quan: `pending` ➔ `running` ➔ `success` / `failed` / `retrying`.

---

## 📋 Yêu Cầu Chức Năng Bắt Buộc (Functional Requirements)

| ID | Yêu cầu | Mô tả chi tiết | Điều kiện đạt |
| :--- | :--- | :--- | :--- |
| **FR-01** | Tạo lịch task | Tạo mới task với đầy đủ thông tin: `type`, `payload`, `scheduleAt` hoặc `cronExpr`. | Tạo thành công và lưu trữ vào Cơ sở dữ liệu (DB). |
| **FR-02** | Push task | Cung cấp endpoint nhận task từ hệ thống bên ngoài (`POST /api/schedules/push`). | Task được đẩy thành công vào hàng đợi (Queue) hoặc bộ lập lịch (Scheduler). |
| **FR-03** | Scheduler engine | Job được thực thi chính xác tại thời điểm cấu hình; hỗ trợ cơ chế retry khi xảy ra lỗi. | Ghi nhận đầy đủ nhật ký (log) thời gian chạy thực tế của hệ thống. |
| **FR-04** | File Read Task | Đọc nội dung file từ các đường dẫn hợp lệ được cung cấp. | Trích xuất và lưu lại kết quả tóm tắt hoặc siêu dữ liệu (metadata). |
| **FR-05** | File Import Task | Nhận cùng lúc nhiều file, tiến hành parse nội dung và lưu trữ dữ liệu cơ bản. | Xuất báo cáo thống kê số lượng file xử lý thành công / thất bại. |
| **FR-06** | Form Fill Task | Điền dữ liệu tự động dựa trên một cấu trúc/template JSON có sẵn. | Kết quả đầu ra (Output) phải chuẩn hóa và khớp với cấu trúc template. |
| **FR-07** | Email Task | Gửi email tự động theo lịch cấu hình, hỗ trợ các trường: `subject`, `body`, `recipients`. | Ghi nhận nhật ký (log) gửi email kèm trạng thái phản hồi chi tiết. |
| **FR-08** | Task status API | Tra cứu danh sách tổng quan hoặc thông tin chi tiết của từng task cụ thể. | Hoạt động chính xác với: `GET /api/schedules` và `GET /api/schedules/:id`. |
| **FR-09** | Idempotency | Chống trùng lặp dữ liệu khi hệ thống ngoài push một task nhiều lần với cùng một `key`. | Ngăn chặn hoàn toàn việc tạo các lượt thực thi trùng lặp (duplicate run). |
| **FR-10** | Cancel/Pause | Hỗ trợ người dùng hoặc hệ thống hủy bỏ (Cancel) hoặc tạm dừng (Pause) các task chưa chạy. | Cập nhật chính xác và đồng bộ trạng thái mới của task trong DB. |

---

## ⚙️ Yêu Cầu Kỹ Thế Bắt Buộc (Non-Functional Requirements)

| ID | Yêu cầu kỹ thuật | Điều kiện đạt |
| :--- | :--- | :--- |
| **NFR-01** | Kiến trúc rõ ràng | Áp dụng mô hình phân lớp chuẩn: **Route ➔ Controller ➔ Service ➔ Repository** (hoặc kiến trúc tương đương như Clean/Hexagonal Architecture). |
| **NFR-02** | Logging có trace | Mỗi request hoặc job thực thi phải được gắn kèm một mã định danh duy nhất (`correlationId`) để dễ dàng trace log. |
| **NFR-03** | Xử lý lỗi chuẩn | Định nghĩa cấu trúc mã lỗi (error code) và thông điệp (message) nhất quán; đảm bảo lỗi không làm crash dịch vụ. |
| **NFR-04** | Retry + timeout | Thiết lập thời gian chờ tối đa (timeout) khi tương tác với các tác vụ bên ngoài; cấu hình được số lần retry tối đa. |
| **NFR-05** | Validation | Xây dựng bộ quy tắc kiểm tra tính hợp lệ dữ liệu đầu vào (payload validation) nghiêm ngặt cho từng loại task cụ thể. |
| **NFR-06** | Test | Viết đầy đủ Unit Test và Integration Test / Smoke Test để bảo vệ và kiểm thử các luồng nghiệp vụ chính (main flows). |
| **NFR-07** | Docker | Hệ thống và các tài nguyên đi kèm (DB, Queue,...) phải chạy mượt mà thông qua `docker compose`. |
| **NFR-08** | API docs | Cung cấp tài liệu kỹ thuật cho các API bằng OpenAPI/Swagger hoặc tài liệu đặc tả endpoint tương đương. |

---

## 🌐 Hệ Thống API Tối Thiểu Phải Có

| Method | Endpoint | Mục đích |
| :--- | :--- | :--- |
| `POST` | `/api/schedules` | Tạo mới một schedule task |
| `POST` | `/api/schedules/push` | Tiếp nhận/Push task từ các hệ thống bên ngoài |
| `GET` | `/api/schedules` | Lấy danh sách toàn bộ các task trong hệ thống |
| `GET` | `/api/schedules/:id` | Xem chi tiết cấu hình và trạng thái của một task |
| `PATCH` | `/api/schedules/:id/cancel` | Yêu cầu hủy bỏ một task (khi chưa thực thi) |
| `GET` | `/health` | Kiểm tra tình trạng hoạt động của dịch vụ (Health check) |
| `GET` | `/ready` | Kiểm tra tính sẵn sàng tiếp nhận request của dịch vụ (Readiness check) |

---

## 📦 Danh Mục Sản Phẩm Bàn Giao (Deliverables)

| Mục nộp | Yêu cầu bắt buộc |
| :--- | :---: |
| 💻 **Source code** | **Có** |
| 📖 **README** hướng dẫn cài đặt chạy local & chạy test | **Có** |
| 🚀 **API collection** (Postman / Bruno / curl) | **Có** |
| 📊 **Test report** (Ảnh chụp màn hình hoặc log thực thi test) | **Có** |
| 📐 **Tài liệu kiến trúc** ngắn gọn (Gói gọn trong 1 trang) | **Có** |
