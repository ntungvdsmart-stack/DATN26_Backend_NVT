const AuthService = require('../services/authService');
const { sendResponse } = require('../utils/responseHelper');
const { sendBrandedEmail } = require('../utils/mailHelper');
const emailTemplates = require('../utils/emailTemplates');

const AuthController = {
    // Đăng ký tài khoản khách hàng
    registerCustomer: async (req, res, next) => {
        try {
            const { password } = req.body;
            const full_name = typeof req.body.full_name === 'string' ? req.body.full_name.trim() : '';
            const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
            const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : null;
            
            if (!full_name || !email || !password) {
                return sendResponse(res, 400, false, 'Vui lòng cung cấp đầy đủ họ tên, email và mật khẩu');
            }
            if (full_name.length < 2 || full_name.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150 || typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72 || (phone && !/^(0\d{9}|\+84\d{9})$/.test(phone))) {
                return sendResponse(res, 400, false, 'Họ tên 2–150 ký tự, email và số điện thoại hợp lệ; mật khẩu từ 8 ký tự, tối đa 72 byte');
            }

            const newCustomer = await AuthService.registerCustomer({ full_name, email, password, phone });
            
            // Gửi email chào mừng (Bất đồng bộ, không đợi)
            void sendBrandedEmail(email, brand => emailTemplates.welcome(brand, full_name), { idempotencyKey: `welcome-${newCustomer.customer_id}` });

            sendResponse(res, 201, true, 'Đăng ký tài khoản thành công', newCustomer);
        } catch (error) {
            next(error);
        }
    },

    // Đăng nhập thống nhất — Dùng cho TẤT CẢ role (Customer, Staff, Admin)
    // Nhận "identifier" = email
    login: async (req, res, next) => {
        try {
            const { identifier, password } = req.body;
            const ipAddress = req.ip || req.connection?.remoteAddress;
            
            if (typeof identifier !== 'string' || !identifier.trim() || typeof password !== 'string' || !password || identifier.length > 150 || Buffer.byteLength(password) > 72) {
                return sendResponse(res, 400, false, 'Vui lòng cung cấp email/tên đăng nhập và mật khẩu');
            }

            const data = await AuthService.login(identifier.trim(), password, ipAddress);
            sendResponse(res, 200, true, 'Đăng nhập thành công', data);
        } catch (error) {
            next(error);
        }
    }
};

module.exports = AuthController;
