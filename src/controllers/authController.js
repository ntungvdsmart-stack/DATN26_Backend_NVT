const AuthService = require('../services/authService');
const { sendResponse } = require('../utils/responseHelper');
const { sendEmail } = require('../utils/mailHelper');

const AuthController = {
    // Đăng ký tài khoản khách hàng
    registerCustomer: async (req, res, next) => {
        try {
            const { full_name, email, password, phone } = req.body;
            
            if (!full_name || !email || !password) {
                return sendResponse(res, 400, false, 'Vui lòng cung cấp đầy đủ họ tên, email và mật khẩu');
            }

            const newCustomer = await AuthService.registerCustomer({ full_name, email, password, phone });
            
            // Gửi email chào mừng (Bất đồng bộ, không đợi)
            const welcomeHtml = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                    <h2 style="color: #000;">Chào mừng đến với FashionOS, ${full_name}!</h2>
                    <p>Tài khoản của bạn đã được tạo thành công. Chúng tôi rất vui mừng được đồng hành cùng phong cách của bạn.</p>
                    <p>Đăng nhập ngay để khám phá những bộ sưu tập mới nhất với vô vàn ưu đãi đặc quyền dành cho thành viên.</p>
                    <a href="${req.protocol}://${req.get('host')}" style="display: inline-block; padding: 10px 20px; background-color: #000; color: #fff; text-decoration: none; font-weight: bold; border-radius: 5px; margin-top: 15px;">Mua sắm ngay</a>
                </div>
            `;
            sendEmail(email, '🎉 Chào mừng bạn đến với FashionOS!', welcomeHtml);

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
