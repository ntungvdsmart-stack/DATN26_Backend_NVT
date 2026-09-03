const bcrypt = require('bcryptjs');
const AccountModel = require('../models/accountModel');
const { sendResponse } = require('../utils/responseHelper');

const AccountController = {
    // 1. Lấy danh sách tất cả tài khoản nội bộ
    getAllAccounts: async (req, res, next) => {
        try {
            const accounts = await AccountModel.getAll();
            
            // Xóa trường password_hash trước khi trả về để bảo mật
            const sanitizedAccounts = accounts.map(acc => {
                const { password_hash, ...rest } = acc;
                return rest;
            });

            sendResponse(res, 200, true, 'Lấy danh sách tài khoản thành công', sanitizedAccounts);
        } catch (error) {
            next(error);
        }
    },

    // 2. Tạo tài khoản mới (Chỉ Admin)
    createAccount: async (req, res, next) => {
        try {
            const { username, full_name, email, phone, password, role_id } = req.body;

            // Validate cơ bản
            if (!username || !full_name || !email || !password || !role_id) {
                return sendResponse(res, 400, false, 'Vui lòng cung cấp đầy đủ thông tin bắt buộc (username, full_name, email, password, role_id)');
            }

            // Kiểm tra trùng username hoặc email
            const existingAccount = await AccountModel.findByEmailOrUsername(email);
            const existingUsername = await AccountModel.findByEmailOrUsername(username);

            if (existingAccount || existingUsername) {
                return sendResponse(res, 400, false, 'Username hoặc Email đã được sử dụng trong hệ thống');
            }

            // Băm mật khẩu
            const salt = await bcrypt.genSalt(10);
            const password_hash = await bcrypt.hash(password, salt);

            // Lưu vào DB
            const newAccountId = await AccountModel.create({
                username, password_hash, full_name, email, phone, role_id
            });

            // Ghi log hoạt động
            AccountModel.logActivity({
                account_id: req.user.id, // ID của Admin đang thao tác
                action: 'CREATE_ACCOUNT',
                target_table: 'accounts',
                target_id: newAccountId,
                description: `Tạo tài khoản mới: ${username}`,
                ip_address: req.ip || req.connection?.remoteAddress
            }).catch(console.error);

            sendResponse(res, 201, true, 'Tạo tài khoản nội bộ thành công', { id: newAccountId });
        } catch (error) {
            next(error);
        }
    },

    // 3. Cập nhật thông tin (Chỉ Admin)
    updateAccount: async (req, res, next) => {
        try {
            const { id } = req.params;
            const { full_name, phone, role_id } = req.body;

            if (!full_name || !role_id) {
                return sendResponse(res, 400, false, 'Họ tên và Vai trò (Role) không được để trống');
            }

            // Không cho phép sửa thông tin của tài khoản "admin" gốc (hardcoded bảo vệ)
            if (parseInt(id) === 1) { // Giả sử ID=1 là admin tối cao, có thể đổi logic này
                return sendResponse(res, 403, false, 'Không thể chỉnh sửa tài khoản Admin hệ thống');
            }

            await AccountModel.update(id, { full_name, phone, role_id });

            AccountModel.logActivity({
                account_id: req.user.id,
                action: 'UPDATE_ACCOUNT',
                target_table: 'accounts',
                target_id: id,
                description: `Cập nhật thông tin tài khoản ID: ${id}`,
                ip_address: req.ip || req.connection?.remoteAddress
            }).catch(console.error);

            sendResponse(res, 200, true, 'Cập nhật tài khoản thành công');
        } catch (error) {
            next(error);
        }
    },

    // 4. Bật/Tắt trạng thái tài khoản (Khóa/Mở Khóa)
    toggleAccountStatus: async (req, res, next) => {
        try {
            const { id } = req.params;
            const { is_active } = req.body; // 1 hoặc 0

            if (is_active === undefined) {
                return sendResponse(res, 400, false, 'Trạng thái is_active không được cung cấp');
            }

            // Bảo vệ không cho tự khóa chính mình
            if (parseInt(id) === req.user.id) {
                return sendResponse(res, 403, false, 'Bạn không thể tự khóa tài khoản của chính mình');
            }

            await AccountModel.toggleStatus(id, is_active ? 1 : 0);

            AccountModel.logActivity({
                account_id: req.user.id,
                action: 'TOGGLE_ACCOUNT_STATUS',
                target_table: 'accounts',
                target_id: id,
                description: `${is_active ? 'Mở khóa' : 'Khóa'} tài khoản ID: ${id}`,
                ip_address: req.ip || req.connection?.remoteAddress
            }).catch(console.error);

            sendResponse(res, 200, true, `Đã ${is_active ? 'mở khóa' : 'khóa'} tài khoản thành công`);
        } catch (error) {
            next(error);
        }
    }
};

module.exports = AccountController;
