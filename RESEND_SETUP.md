# Resend và email thương hiệu

Đã tích hợp Resend REST API, không cần cài thêm SDK. API key chỉ nằm trong backend/.env và được loại trừ bởi .gitignore. Không đưa key vào frontend, system_settings công khai hoặc tài liệu.

## Tình trạng hiện tại

- MAIL_PROVIDER=resend; API key đã lưu; MAIL_FROM_ADDRESS=onboarding@resend.dev.
- Người dùng xác nhận chưa có tên miền. Đây là chế độ thử: Resend chỉ cho gửi về địa chỉ email chủ tài khoản Resend, không gửi được cho toàn bộ khách hàng.
- Thao tác đọc danh sách domains trả restricted_api_key: khóa không có quyền đọc danh sách tên miền. Không kết luận khóa sai và không yêu cầu mở thêm quyền quản trị chỉ để gửi email.
- Chưa gửi email thật. Build frontend và kiểm tra cú pháp backend đã qua; không chạy test chức năng theo yêu cầu trước đó.

## Sử dụng

1. Khởi động lại backend để nạp .env mới.
2. Đăng nhập Admin → Cài đặt hệ thống → Email.
3. Điền tên shop, email hỗ trợ. Tải logo PNG/JPG tối đa 2 MB (qua Cloudinary đã cấu hình) hoặc dán URL HTTPS công khai. Nên dùng ảnh vuông, đủ tương phản trên nền tối. Nếu chưa có logo, email hiển thị biểu tượng chữ và tên shop.
4. Nhấn Lưu thay đổi, rồi Tải lại mẫu. Có 3 mẫu xem trước: chào mừng, khôi phục mật khẩu, đơn hàng. Dữ liệu xem trước là dữ liệu minh họa.
5. Nhập đúng email chủ tài khoản Resend vào ô nhận thử, bấm Gửi email thử. Tối đa 5 lần/giờ. Resend chấp nhận yêu cầu chưa đồng nghĩa thư đã vào Inbox; xem Emails trong Resend và thư mục Spam.

Tên hiển thị người gửi lấy từ store_name; logo trong nội dung lấy store_logo_url, dự phòng MAIL_LOGO_URL. Email hỗ trợ lấy store_email; MAIL_REPLY_TO nếu được đặt sẽ ưu tiên làm địa chỉ trả lời. Logo trong email không đồng nghĩa ảnh đại diện bên cạnh người gửi trong Gmail/Outlook.

## Gửi cho khách hàng thật

1. Có tên miền bạn sở hữu; vào Resend → Domains → thêm tên miền hoặc subdomain gửi thư.
2. Thêm các bản ghi DNS Resend yêu cầu, chờ trạng thái Verified. Tên miền có thể phát sinh chi phí riêng; gói gửi miễn phí không cung cấp tên miền miễn phí.
3. Đặt MAIL_FROM_ADDRESS=donhang@tenmien-da-xac-thuc.vn trong backend/.env. Đảm bảo API key được phép gửi từ domain này. Không dùng địa chỉ Gmail làm From trong Resend.
4. Đặt FRONTEND_URL thành URL website thật để các nút mở đúng trang. Không dùng localhost khi gửi cho khách bên ngoài máy đang chạy dự án.
5. Khởi động lại backend và gửi thử từ trang quản trị.

## Luồng email

- Đăng ký thành công: chào mừng, nút khám phá cửa hàng.
- Quên mật khẩu: nút và liên kết dự phòng, thời hạn 15 phút/dùng một lần. Không log token hoặc nội dung thư.
- Tạo đơn online và đổi trạng thái: mã đơn, sản phẩm/size/màu/số lượng/giá, tổng đơn và nút xem đơn. Chỉ gửi sau commit, không làm thất bại đơn vì lỗi gửi thư. Không gửi các thay đổi silent nội bộ.
- Nội dung động được escape HTML, có bản text, preheader, bố cục bảng phù hợp ứng dụng email và logo dự phòng. Dùng idempotency key tránh gửi trùng sự kiện trong thời hạn dedup của Resend.
- Chỉ báo thành công sau khi Resend nhận request và trả email ID; lỗi provider không ghi key, email người nhận, HTML hoặc token ra log.
- Chưa có hàng đợi bền vững/webhook theo dõi delivered/bounced hoặc cơ chế tự gửi bù khi process dừng; không xem log accepted là bằng chứng thư đã giao thành công.
- Bộ integration hiện có đã được cấu hình RESEND_API_KEY rỗng trong tiến trình fixture để tránh gửi thư thật nếu người dùng chạy test sau này; chưa chạy lại.

Tài liệu chính thức: https://resend.com/docs/api-reference/emails/send-email ; https://resend.com/docs/knowledge-base/403-error-resend-dev-domain ; https://resend.com/docs/dashboard/domains/introduction
