# Chuyển dự án sang máy khác và tự bổ sung database

## Cách khuyến nghị: chạy backend

1. Cài Node.js 22+ và MySQL 8.0.16+ (hỗ trợ CHECK_CONSTRAINTS). Sao chép cả thư mục backend, bao gồm `sql/schema.source.sql`, không chỉ riêng src.
2. Cấu hình DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME trong backend/.env cho máy mới. Không ghi đè các thông tin đăng nhập của máy mới bằng cấu hình máy cũ.
3. Trong backend, chạy `npm install` nếu chưa có dependencies.
4. Chạy `npm run db:migrate` để cập nhật riêng database, hoặc `npm start` / `npm run dev` để backend tự cập nhật trước khi mở cổng API.

Nếu database chưa tồn tại, backend thử tạo đúng DB_NAME bằng tài khoản đã cấu hình. Nếu tài khoản không có quyền CREATE DATABASE, hãy tạo database rỗng trước bằng tài khoản quản trị MySQL, rồi chạy lại. Nếu database đã có thì không cần quyền tạo database mới.

Backend kiểm tra thông tin schema và chỉ bổ sung phần thiếu:

- Tạo bảng thiếu, sau đó cột thiếu, index/unique/primary key thiếu, khóa ngoại và CHECK thiếu.
- Thêm trigger/view còn thiếu; giữ trigger/view đã tồn tại.
- Thêm quyền hệ thống cần thiết và chạy migration vai trò theo phiên bản. Không khôi phục lại quyền mặc định trên mỗi lần khởi động sau khi migration đã được ghi nhận.
- Giữ advisory lock theo database trong toàn bộ quá trình, tránh hai tiến trình backend tự cập nhật đồng thời.
- Không tắt FOREIGN_KEY_CHECKS, không DROP TABLE, không chèn tài khoản/mật khẩu/đơn/sản phẩm mẫu. Không đổi tên, kiểu dữ liệu, NULL/default hoặc luật cascade của cấu trúc đã có.
- Database mới chỉ có cấu trúc và vai trò/quyền cần thiết, không có dữ liệu cửa hàng cũ. Muốn chuyển cả dữ liệu phải export/import dữ liệu từ máy cũ. Không chạy seed sản phẩm trên database có dữ liệu thật.

Tài khoản MySQL chạy migration cần quyền đọc metadata và CREATE/ALTER/INDEX/REFERENCES/TRIGGER/CREATE VIEW cùng quyền đọc/ghi các bảng liên quan. Thiếu quyền sẽ được báo và backend chưa nhận request. DDL MySQL tự commit, không thể rollback cả quá trình bằng transaction; nếu dừng giữa chừng, sửa nguyên nhân rồi chạy lại để tiếp tục các phần còn thiếu.

## Import SQL trực tiếp

File `DoAnMo/fashion_database.sql` hiện là script bổ sung cấu trúc có thể chạy lại, dùng **MySQL 8.0.29+** vì câu CREATE TRIGGER IF NOT EXISTS. Import nguyên file bằng Workbench/phpMyAdmin/mysql client có hỗ trợ DELIMITER và quyền CREATE/ALTER ROUTINE. MySQL 8.0.16–8.0.28 nên dùng backend ở trên thay cho import file này.

- Tên database mặc định trong SQL là fashion_multichannel. Nếu muốn tên khác, chỉnh CREATE DATABASE và USE đầu file trước khi import. Backend luôn dùng DB_NAME riêng trong .env.
- Script chỉ drop/tạo routine hỗ trợ `fashion_apply_schema_v3` do dự án sở hữu; không xóa bảng hoặc dữ liệu nghiệp vụ.
- Không import SQL đồng thời với một phiên import SQL khác. Nếu import bị dừng ở đoạn tạo trigger, đóng kết nối import để giải phóng advisory lock rồi chạy lại sau khi xử lý nguyên nhân.
- Sau import, khởi động backend để chạy migration dữ liệu theo phiên bản và xem tóm tắt `[schema]`.

## Khi schema cũ có dữ liệu không hợp lệ

Không thể tự đoán các giá trị bắt buộc đã mất. Ví dụ bảng đơn đã có dữ liệu nhưng thiếu customer_id bắt buộc ở một bảng liên quan, hoặc các dòng trùng vi phạm UNIQUE, hoặc tham chiếu tới bản ghi cha không có: migration sẽ dừng và báo lỗi; không tự xóa dữ liệu, gán ID 0 hoặc bỏ ràng buộc để chạy tiếp. Cần backup, khôi phục/backfill đúng dữ liệu rồi chạy lại.

Riêng username tài khoản cũ được bổ sung nullable để không chế ra tên đăng nhập cho nhân viên; API vẫn yêu cầu username hợp lệ khi tạo mới. Migration tích điểm cũ được giữ khi cột loyalty_points vừa được bổ sung.

## Cập nhật schema về sau

Nguồn chuẩn: `backend/sql/schema.source.sql`. Đây là file định nghĩa cho công cụ, **không import trực tiếp**.

1. Thêm định nghĩa bảng/cột/index/FK/trigger/view vào nguồn chuẩn.
2. Chạy `npm run db:generate` trong backend để sinh lại `DoAnMo/fashion_database.sql`. Lệnh này chỉ viết file, không kết nối hoặc sửa database.
3. Backend đọc nguồn chuẩn khi khởi động và bổ sung đối tượng còn thiếu. Đổi kiểu/đổi tên/xóa cột cần migration dữ liệu riêng, không thực hiện tự động bằng bộ đồng bộ bổ sung này.

Đợt chỉnh sửa này đã kiểm tra parser bao phủ 37 bảng / 230 cột / 66 index định nghĩa / 52 khóa ngoại / 6 trigger / 5 view và kiểm tra cú pháp JavaScript. Chưa import hoặc chạy migration trên database thật, chưa chạy test chức năng theo yêu cầu trước đó; các con số là cấu trúc chuẩn, không phải số thay đổi đã áp dụng trên database.
