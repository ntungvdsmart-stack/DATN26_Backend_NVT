const { randomUUID } = require('node:crypto');
const { getBrand } = require('../services/emailBrandService');
const templates = require('./emailTemplates');
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(value);
const deliveryError = (code, message, statusCode = 422) => Object.assign(new Error(message), { code, statusCode, details: { code } });
function providerError(status, result) {
    const message = String(result.message || '');
    if (/testing emails|own email address/i.test(message)) return deliveryError('EMAIL_TEST_RECIPIENT', 'Resend đang ở chế độ thử. Hãy nhập đúng email bạn dùng đăng ký tài khoản Resend, không phải email khách hàng hoặc email hỗ trợ của shop. Muốn gửi tới địa chỉ khác cần xác thực tên miền.');
    if (/domain.*(not verified|not.*verified|verify)|verify.*domain/i.test(message)) return deliveryError('EMAIL_DOMAIN_UNVERIFIED', 'Tên miền của địa chỉ gửi chưa được xác thực trong Resend. Dùng onboarding@resend.dev để gửi thử về email chủ tài khoản hoặc xác thực tên miền trước.');
    if (status === 401 || result.name === 'restricted_api_key') return deliveryError('EMAIL_API_KEY', 'API key chưa hợp lệ hoặc không có quyền gửi từ địa chỉ này. Kiểm tra Sending access và phạm vi tên miền của key trong Resend.');
    if (status === 429) return deliveryError('EMAIL_RATE_LIMIT', 'Resend đang giới hạn tốc độ hoặc hạn mức gửi. Vui lòng kiểm tra hạn mức và thử lại sau.', 503);
    if (status === 403) return deliveryError('EMAIL_SENDER_RESTRICTED', 'Resend từ chối quyền gửi. Kiểm tra địa chỉ gửi, tên miền được phép của API key và trạng thái tài khoản trong Resend.');
    return deliveryError('EMAIL_PROVIDER_REJECTED', 'Resend chưa chấp nhận email. Kiểm tra địa chỉ gửi/nhận và chi tiết yêu cầu trong Resend.', status >= 500 ? 502 : 422);
}

function emailStatus() {
    const provider = process.env.MAIL_PROVIDER || (process.env.RESEND_API_KEY ? 'resend' : 'smtp');
    const sender = provider === 'resend' ? (process.env.MAIL_FROM_ADDRESS || 'onboarding@resend.dev') : (process.env.MAIL_USER || '');
    return { provider, configured: provider === 'resend' ? Boolean(process.env.RESEND_API_KEY && validEmail(sender)) : Boolean(provider === 'smtp' && validEmail(sender) && process.env.MAIL_PASS?.trim()), sender, test_mode: provider === 'resend' && sender.endsWith('@resend.dev') };
}
async function deliver(to, subject, content, brand, options = {}) {
    if (!validEmail(to) || typeof subject !== 'string' || /[\r\n]/.test(subject)) return false;
    const status = emailStatus();
    if (!status.configured) {
        if (options.throwOnError) throw deliveryError('EMAIL_NOT_CONFIGURED', 'Backend chưa nạp cấu hình gửi email. Kiểm tra .env và khởi động lại backend.');
        return false;
    }
    const fromName = brand.name.replace(/[<>"\r\n]/g, '').slice(0, 100);
    const replyTo = process.env.MAIL_REPLY_TO || brand.support;
    try {
        if (status.provider === 'resend') {
            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST', signal: AbortSignal.timeout(15000),
                headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': options.idempotencyKey || randomUUID() },
                body: JSON.stringify({ from: `${fromName} <${status.sender}>`, to: [to], subject, html: content.html, text: content.text, ...(validEmail(replyTo) ? { reply_to: replyTo } : {}) })
            });
            const result = await response.json();
            if (!response.ok || !result.id) {
                // Do not log recipients, body, reset tokens or raw provider errors.
                console.error('[email] Resend rejected request', { status: response.status, testMode: status.test_mode });
                throw providerError(response.status, result);
            }
            console.info('[email] Resend accepted', { id: result.id });
            return true;
        }
        const transporter = require('nodemailer').createTransport({
            host: process.env.MAIL_HOST || 'smtp.gmail.com', port: Number(process.env.MAIL_PORT || 587), secure: Number(process.env.MAIL_PORT || 587) === 465, requireTLS: Number(process.env.MAIL_PORT || 587) !== 465,
            connectionTimeout: 10000, socketTimeout: 15000,
            auth: { user: process.env.MAIL_USER, pass: (process.env.MAIL_HOST || 'smtp.gmail.com') === 'smtp.gmail.com' ? process.env.MAIL_PASS.replace(/\s/g, '') : process.env.MAIL_PASS }
        });
        await transporter.sendMail({ from: `${fromName} <${process.env.MAIL_USER}>`, to, subject, ...content, ...(validEmail(replyTo) ? { replyTo } : {}) });
        return true;
    } catch (error) {
        if (error.code === 'EAUTH') error = deliveryError('EMAIL_SMTP_AUTH', 'Gmail từ chối đăng nhập. Kiểm tra MAIL_USER và mật khẩu ứng dụng Google trong MAIL_PASS; không dùng mật khẩu đăng nhập Gmail thông thường.');
        else if (error.code === 'EENVELOPE') error = deliveryError('EMAIL_SMTP_RECIPIENT', 'Máy chủ email từ chối địa chỉ gửi hoặc nhận. Kiểm tra email và hạn mức gửi của tài khoản.');
        const failure = error.code?.startsWith('EMAIL_') ? error : deliveryError('EMAIL_CONNECTION', 'Không kết nối được dịch vụ gửi email hoặc yêu cầu đã quá thời gian. Vui lòng thử lại.', 503);
        console.error('[email] Delivery failed', { code: failure.code });
        if (options.throwOnError) throw failure;
        return false;
    }
}
async function sendBrandedEmail(to, makeTemplate, options) {
    try {
        const brand = await getBrand();
        const template = makeTemplate(brand);
        return await deliver(to, `${brand.name} · ${template.title}`, templates.renderEmail(brand, template), brand, options);
    } catch (error) {
        if (options?.throwOnError) throw error;
        console.error('[email] Could not prepare email'); return false;
    }
}
async function sendEmail(to, subject, htmlContent) {
    return sendBrandedEmail(to, () => ({ title: subject, body: htmlContent }));
}
module.exports = { sendEmail, sendBrandedEmail, emailStatus };
