const express = require('express');
const router = express.Router();
const ConfigController = require('../controllers/configController');
const { protect, authorize } = require('../middlewares/authMiddleware');
router.get('/integrations', protect, authorize('admin'), (req, res) => {
    const email = require('../utils/mailHelper').emailStatus();
    res.json({ success: true, data: { payments: require('../services/gatewayService').available(), email: email.configured, email_status: email, cloudinary: Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET), ai: require('../services/geminiService').hasApiKeys() } });
});
router.get('/email-preview', protect, authorize('admin'), async (req, res, next) => {
    try {
        const brand = await require('../services/emailBrandService').getBrand();
        const templates = require('../utils/emailTemplates');
        const type = req.query.type || 'welcome';
        const samples = {
            welcome: () => templates.welcome(brand, 'Khách hàng'),
            reset: () => templates.passwordOtp(brand, '123456'),
            order: () => templates.orderUpdate(brand, { order_code: 'XEM-TRUOC', customer_name: 'Khách hàng', total_amount: 329000 }, [{ product_name: 'Áo thun Cotton', color_name: 'Trắng', size_value: 'M', quantity: 1, unit_price: 299000 }], 'pending')
        };
        if (!Object.hasOwn(samples, type)) return res.status(400).json({ success: false, message: 'Loại email không hợp lệ' });
        res.set('Cache-Control', 'no-store').json({ success: true, data: templates.renderEmail(brand, samples[type]()) });
    } catch (error) { next(error); }
});
router.post('/email-test', protect, authorize('admin'), require('express-rate-limit').rateLimit({ windowMs: 3600000, limit: 5, message: { success: false, message: 'Đã đạt giới hạn 5 email thử mỗi giờ. Vui lòng thử lại sau.' } }), async (req, res, next) => {
    try {
        const to = typeof req.body.to === 'string' ? req.body.to.trim() : '';
        if (!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(to) || to.length > 254) return res.status(400).json({ success: false, message: 'Nhập email nhận hợp lệ' });
        const sent = await require('../utils/mailHelper').sendBrandedEmail(to, brand => require('../utils/emailTemplates').welcome(brand, 'Bạn'), { throwOnError: true });
        if (!sent) return res.status(502).json({ success: false, message: 'Resend chưa chấp nhận email. Với địa chỉ resend.dev, chỉ gửi về email chủ tài khoản Resend; hãy kiểm tra quyền API key và địa chỉ gửi.' });
        res.json({ success: true, message: 'Resend đã tiếp nhận email. Kiểm tra Hộp thư đến/Spam và mục Emails trong Resend.' });
    } catch (error) { next(error); }
});

// GET (Public) - Lấy cấu hình hệ thống
router.get('/', ConfigController.getSettings);

// PUT (Admin) - Chỉ có admin mới được quyền cập nhật
router.put('/', protect, authorize('admin'), ConfigController.updateSettings);

module.exports = router;
