const { escapeHtml: e } = require('../services/emailBrandService');
const statuses = { pending: 'Đã nhận đơn hàng', confirmed: 'Đơn hàng đã được xác nhận', processing: 'Đang chuẩn bị hàng', shipping: 'Đơn hàng đang được giao', completed: 'Đơn hàng đã hoàn tất', cancelled: 'Đơn hàng đã hủy', returned: 'Đơn hàng đã trả' };
const money = value => `${Number(value || 0).toLocaleString('vi-VN')}đ`;
function renderEmail(brand, { title, preheader, body, action, actionUrl, note }) {
    const logo = brand.logo
        ? `<img src="${e(brand.logo)}" width="64" height="64" alt="${e(brand.name)}" style="display:block;border:0;object-fit:contain;margin:0 auto 14px;border-radius:12px">`
        : `<div style="margin:0 auto 14px;width:60px;height:60px;line-height:60px;background:#f4f1eb;border-radius:14px;color:#191919;font-size:22px;font-weight:bold;letter-spacing:1px">${e(brand.name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase())}</div>`;
    const html = `<!doctype html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f2ef;font-family:Arial,Helvetica,sans-serif;color:#242424">
<div style="display:none;font-size:1px;line-height:1px;color:#f4f2ef;max-height:0;overflow:hidden">${e(preheader || title)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f2ef"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #e6e1da;border-radius:16px;overflow:hidden">
<tr><td align="center" style="padding:30px 24px;background:#191919;color:#fff">${logo}<div style="font-size:23px;letter-spacing:2px;font-weight:bold">${e(brand.name)}</div><div style="margin-top:8px;font-size:11px;letter-spacing:2px;color:#c8c0b4">THỜI TRANG · PHONG CÁCH · TRẢI NGHIỆM</div></td></tr>
<tr><td style="padding:30px 24px;font-size:15px;line-height:1.75;word-break:break-word"><h1 style="margin:0 0 20px;font-size:24px;line-height:1.35;color:#191919">${e(title)}</h1>${body}
${action && actionUrl ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0"><tr><td bgcolor="#191919" style="border-radius:8px"><a href="${e(actionUrl)}" style="display:inline-block;padding:14px 24px;font-size:14px;font-weight:bold;color:#fff;text-decoration:none">${e(action)} →</a></td></tr></table><p style="font-size:12px;color:#777">Nếu nút không mở được, sao chép liên kết này:<br><a href="${e(actionUrl)}" style="color:#555;word-break:break-all">${e(actionUrl)}</a></p>` : ''}
${note ? `<p style="padding:14px 16px;background:#f7f5f1;border-left:3px solid #b2a18c;font-size:13px;color:#655b4e">${e(note)}</p>` : ''}
<p style="margin-top:24px">Trân trọng,<br><strong>Đội ngũ ${e(brand.name)}</strong></p></td></tr>
<tr><td style="padding:22px 24px;background:#faf9f7;border-top:1px solid #eee8e0;font-size:12px;line-height:1.8;color:#777;text-align:center">
${brand.support ? `Hỗ trợ: <a href="mailto:${e(brand.support)}" style="color:#555">${e(brand.support)}</a><br>` : ''}${brand.phone ? `${e(brand.phone)}<br>` : ''}${brand.address ? `${e(brand.address)}<br>` : ''}
Email giao dịch tự động từ ${e(brand.name)}.<br>© ${new Date().getFullYear()} ${e(brand.name)}</td></tr></table></td></tr></table></body></html>`;
    const text = `${brand.name}\n${title}\n\n${body.replace(/<\/(?:p|tr|h\d)>/g, '\n').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')}\n\n${action || ''} ${actionUrl || ''}\n${note || ''}\n${brand.support || ''} ${brand.phone || ''}`;
    return { html, text };
}
const welcome = (brand, name) => ({ title: `Chào mừng bạn đến với ${brand.name}`, preheader: 'Tài khoản của bạn đã sẵn sàng.', body: `<p>Xin chào <strong>${e(name)}</strong>,</p><p>Cảm ơn bạn đã lựa chọn ${e(brand.name)}. Tài khoản của bạn đã được tạo thành công.</p><p>Bạn có thể khám phá sản phẩm, lưu mẫu yêu thích và theo dõi đơn mua ngay trong tài khoản.</p>`, action: 'Khám phá cửa hàng', actionUrl: `${brand.website}/store` });
const passwordOtp = (brand, code) => ({ title: 'Mã OTP đặt lại mật khẩu', preheader: 'OTP có hiệu lực trong 60 giây.', body: `<p>Nhập mã dưới đây tại trang quên mật khẩu của ${e(brand.name)}:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;background:#f7f5f1;padding:18px;border-radius:8px">${e(code)}</p><p>Mã chỉ dùng một lần và hết hạn sau 1 phút kể từ khi tạo.</p>`, note: 'Không chia sẻ OTP với bất kỳ ai. Nếu không yêu cầu, bạn có thể bỏ qua email này.' });
const orderUpdate = (brand, order, items, status) => ({
    title: statuses[status] || 'Cập nhật đơn hàng', preheader: `${order.order_code} · ${statuses[status] || status}`,
    body: `<p>Xin chào <strong>${e(order.customer_name)}</strong>,</p><p>Đơn <strong>${e(order.order_code)}</strong>: ${e(statuses[status] || status)}.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:14px">${items.map(item => `<tr><td style="padding:12px 0;border-bottom:1px solid #eee">${e(item.product_name)}<br><span style="color:#777">${e(item.color_name || '')} ${e(item.size_value || '')} · ×${Number(item.quantity)}</span></td><td align="right" style="padding:12px 0;border-bottom:1px solid #eee;white-space:nowrap">${money(Number(item.unit_price) * Number(item.quantity))}</td></tr>`).join('')}</table><p style="font-size:18px"><strong>Tổng đơn: ${money(order.total_amount)}</strong></p><p style="font-size:13px;color:#777">Tổng đơn đã gồm các khoản giảm giá và phí vận chuyển áp dụng. Thông tin thanh toán/hoàn tiền được cập nhật trong chi tiết đơn.</p>`,
    action: 'Xem đơn hàng', actionUrl: `${brand.website}/store/tracking?code=${encodeURIComponent(order.order_code)}`,
    note: status === 'pending' ? 'Email này xác nhận cửa hàng đã nhận đơn, không phải xác nhận đã thanh toán.' : status === 'cancelled' ? 'Nếu đơn đã thanh toán, vui lòng theo dõi tình trạng hoàn tiền trong chi tiết đơn hoặc liên hệ cửa hàng.' : undefined
});
module.exports = { renderEmail, welcome, passwordOtp, orderUpdate };
