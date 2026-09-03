const AuthService = require('../services/authService');
const { sendResponse } = require('../utils/responseHelper');

const AuthController = {
    // Đăng ký tài khoản khách hàng
    registerCustomer: async (req, res, next) => {
        try {
            const { full_name, email, password, phone } = req.body;
            
            if (!full_name || !email || !password) {
                return sendResponse(res, 400, false, 'Vui lòng cung cấp đầy đủ họ tên, email và mật khẩu');
            }

            const newCustomer = await AuthService.registerCustomer({ full_name, email, password, phone });
            sendResponse(res, 201, true, 'Đăng ký tài khoản thành công', newCustomer);
        } catch (error) {
            next(error);
        }
    },

    // Đăng nhập thống nhất — Dùng cho TẤT CẢ role (Customer, Staff, Admin)
    // Nhận "identifier" = email hoặc username (staff có thể đăng nhập bằng cả 2)
    login: async (req, res, next) => {
        try {
            const { identifier, password } = req.body;
            const ipAddress = req.ip || req.connection?.remoteAddress;
            
            if (!identifier || !password) {
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
