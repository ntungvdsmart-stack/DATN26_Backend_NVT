const nodemailer = require('nodemailer');

const createTransporter = () => {
    // Nếu chưa cấu hình email trong .env thì trả về null để không crash server
    if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
        console.warn('⚠️ Cảnh báo: Chưa cấu hình MAIL_USER và MAIL_PASS trong .env. Tính năng gửi email sẽ bị vô hiệu hóa.');
        return null;
    }

    return nodemailer.createTransport({
        host: 'smtp.mailgun.org',
        port: 587,
        secure: false, // true for port 465, false for port 587
        auth: {
            user: process.env.MAIL_USER,
            pass: process.env.MAIL_PASS
        }
    });
};

const sendEmail = async (to, subject, htmlContent) => {
    if (!to || !subject || !htmlContent) {
        console.error('❌ Lỗi gửi email: Thiếu thông tin người nhận, tiêu đề hoặc nội dung.');
        return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
        console.error(`❌ Lỗi gửi email: Địa chỉ email không hợp lệ (${to})`);
        return false;
    }

    const transporter = createTransporter();
    
    if (!transporter) {
        console.log(`\n[MOCK EMAIL] To: ${to}\nSubject: ${subject}\nBody: ${htmlContent.substring(0, 50)}...\n`);
        return false;
    }

    try {
        const brandName = process.env.BRAND_NAME || 'Thời trang FashionOS';
        
        // Bọc nội dung html lại bằng 1 template chuẩn chuyên nghiệp
        const professionalHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaec; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                <div style="background-color: #0f172a; padding: 20px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: bold; letter-spacing: 1px;">${brandName}</h1>
                </div>
                <div style="padding: 30px; background-color: #ffffff; color: #333333; line-height: 1.6; font-size: 15px;">
                    ${htmlContent}
                </div>
                <div style="background-color: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #eaeaec; color: #64748b; font-size: 13px;">
                    <p style="margin: 0;">Email này được gửi tự động từ hệ thống của ${brandName}. Vui lòng không trả lời.</p>
                    <p style="margin: 8px 0 0;">&copy; ${new Date().getFullYear()} ${brandName}. All rights reserved.</p>
                </div>
            </div>
        `;

        const mailOptions = {
            from: `"${brandName}" <${process.env.MAIL_USER}>`,
            to,
            subject,
            html: professionalHtml
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Đã gửi email thành công: ' + info.messageId);
        return true;
    } catch (error) {
        console.error('❌ Lỗi gửi email: ', error);
        return false;
    }
};

module.exports = {
    sendEmail
};
