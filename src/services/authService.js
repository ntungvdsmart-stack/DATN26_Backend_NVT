const bcrypt = require('bcryptjs');
const CustomerModel = require('../models/customerModel');
const AccountModel = require('../models/accountModel');
const { generateToken } = require('../utils/jwtHelper');

const AuthService = {
    // Đăng ký tài khoản khách hàng mới
    registerCustomer: async (data) => {
        const { full_name, phone, email, password } = data;

        // Kiểm tra email đã tồn tại chưa (dùng 1 truy vấn UNION tối ưu)
        const existing = await CustomerModel.checkEmailExists(email);
        if (existing) {
            throw { statusCode: 400, message: 'Email đã được sử dụng' };
        }

        let posCustomerId = null;
        // Kiểm tra số điện thoại (nếu có)
        if (phone) {
            const existingPhone = await CustomerModel.findByPhone(phone);
            if (existingPhone) {
                // Nếu khách có số điện thoại này nhưng chưa có password (tức là tạo từ POS)
                if (!existingPhone.password_hash) {
                    posCustomerId = existingPhone.customer_id;
                } else {
                    throw { statusCode: 400, message: 'Số điện thoại đã được sử dụng' };
                }
            }
        }

        // Băm mật khẩu
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        if (posCustomerId) {
            // Liên kết tài khoản cho khách POS đã có
            await CustomerModel.updateAccountForPosCustomer(posCustomerId, {
                full_name, email, password_hash
            });
            return { customer_id: posCustomerId, full_name, email, phone };
        } else {
            // Tạo người dùng mới trong CSDL
            const customerId = await CustomerModel.create({
                full_name,
                phone,
                email,
                password_hash,
                customer_type: 'online'
            });

            return { customer_id: customerId, full_name, email, phone };
        }
    },

    // ====================================================
    // ĐĂNG NHẬP THỐNG NHẤT — Dùng chung cho TẤT CẢ ROLE
    // identifier có thể là email hoặc username (staff dùng username)
    // Luồng: tìm theo email trước (UNION customers + accounts)
    //        nếu không thấy → tìm theo username trong accounts
    // ====================================================
    login: async (identifier, password, ipAddress) => {
        let userRecord = null;

        // Thử tìm theo email (hỗ trợ cả customer lẫn staff/admin)
        userRecord = await AccountModel.findUserByEmail(identifier);

        if (!userRecord) {
            userRecord = await AccountModel.findByEmail(identifier);
        }

        if (!userRecord) {
            throw { statusCode: 401, message: 'Thông tin đăng nhập không chính xác' };
        }

        // Kiểm tra tài khoản bị khóa (chỉ áp dụng cho staff/admin)
        if (userRecord.source === 'account' && !userRecord.is_active) {
            throw { statusCode: 403, message: 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.' };
        }

        // Kiểm tra tài khoản guest (không có mật khẩu)
        if (!userRecord.password_hash) {
            throw { statusCode: 401, message: 'Tài khoản này không hỗ trợ đăng nhập bằng mật khẩu' };
        }

        // So sánh mật khẩu
        const isMatch = await bcrypt.compare(password, userRecord.password_hash);
        if (!isMatch) {
            throw { statusCode: 401, message: 'Thông tin đăng nhập không chính xác' };
        }

        // --- Xử lý theo loại tài khoản ---
        if (userRecord.source === 'customer') {
            const token = generateToken({
                id: userRecord.id,
                role: 'customer'
            });

            return {
                token,
                user: {
                    id: userRecord.id,
                    full_name: userRecord.full_name,
                    phone: userRecord.phone,
                    email: userRecord.email,
                    role: 'customer'
                }
            };
        }

        // Staff / Admin — phân role dựa trên role_id
        const roleName = userRecord.role_id === 1 ? 'admin' : 'staff';

        const token = generateToken({
            id: userRecord.id,
            role_id: userRecord.role_id,
            branch_id: userRecord.branch_id,
            role: roleName
        });

        // Ghi nhật ký hoạt động (fire-and-forget, không chặn luồng đăng nhập)
        AccountModel.logActivity({
            account_id: userRecord.id,
            action: 'LOGIN',
            description: 'Đăng nhập hệ thống thành công',
            ip_address: ipAddress
        }).catch(err => console.error('Lỗi ghi nhật ký:', err.message));

        return {
            token,
            user: {
                id: userRecord.id,
                full_name: userRecord.full_name,
                email: userRecord.email,
                role_id: userRecord.role_id,
                branch_id: userRecord.branch_id,
                role: roleName
            }
        };
    }
};

module.exports = AuthService;
