# Khôi phục mật khẩu bằng OTP

- `/reset-password` có ba màn kế tiếp: nhập email → xác thực mã 6 chữ số → nhập mật khẩu mới. Không hiển thị ô mật khẩu tại màn OTP.
- `POST /api/auth/forgot-password` nhận `{ email }`, trả `data.request_id`, `expires_at`, `resend_after`. Email chứa OTP, không chứa liên kết đổi mật khẩu.
- `POST /api/auth/verify-password-otp` nhận `{ request_id, otp }`, trả `data.reset_token` khi hợp lệ. OTP phải là chuỗi 6 chữ số (giữ số 0 đầu); xác thực thành công thì không dùng lại OTP.
- `POST /api/auth/reset-password` nhận `{ reset_token, password }`. Quyền đổi mật khẩu có hạn 5 phút sau khi OTP đã xác thực, dùng một lần; không cho bỏ qua xác thực OTP.
- Hạn 60 giây từ lúc tạo mã do backend quyết định; đồng hồ frontend chỉ hỗ trợ hiển thị. Mã dùng một lần, tối đa 5 lần nhập sai. Gửi lại tối thiểu 60 giây; mã mới vô hiệu mã cũ.
- OTP sinh bằng crypto.randomInt, lưu hash bcrypt trong password_reset_otps; không trả mã qua API, không log mã. Token đổi mật khẩu được lưu hash SHA-256. Các endpoint có rate limiter. Email không tồn tại báo rõ, không gửi OTP; tài khoản bị khóa/không có mật khẩu bị từ chối. Lỗi gửi thư được báo và mã bị vô hiệu, không chuyển sang màn OTP khi gửi lỗi.
- Đổi mật khẩu tăng auth_version, vô hiệu các phiên cũ và các token đặt lại mật khẩu kiểu liên kết còn tồn tại. Endpoint không còn nhận token liên kết.
- Bảng được thêm trong schema nguồn và SQL sinh tự động. Đã chạy migration thành công và xác nhận cấu trúc bảng bằng metadata, build frontend thành công, kiểm tra cú pháp backend thành công; lint còn cảnh báo. Không gửi email thật hoặc chạy kiểm thử chức năng theo yêu cầu trước của người dùng.
