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
            const { full_name, email, phone, password, role_id, branch_id } = req.body;

            // Validate cơ bản
            if (!full_name || !email || !password || !role_id) {
                return sendResponse(res, 400, false, 'Vui lòng cung cấp đầy đủ thông tin bắt buộc (full_name, email, password, role_id)');
            }

            // Kiểm tra trùng email
            const existingAccount = await AccountModel.findByEmail(email);

            if (existingAccount) {
                return sendResponse(res, 400, false, 'Email đã được sử dụng trong hệ thống');
            }

            // Băm mật khẩu
            const salt = await bcrypt.genSalt(10);
            const password_hash = await bcrypt.hash(password, salt);

            // Lưu vào DB
            const newAccountId = await AccountModel.create({
                password_hash, full_name, email, phone, role_id, branch_id
            });

            // Ghi log hoạt động
            AccountModel.logActivity({
                account_id: req.user.id, // ID của Admin đang thao tác
                action: 'CREATE_ACCOUNT',
                target_table: 'accounts',
                target_id: newAccountId,
                description: `Tạo tài khoản mới: ${email}`,
                ip_address: req.ip || req.connection?.remoteAddress
            }).catch(console.error);

            sendResponse(res, 201, true, 'Tạo tài khoản nội bộ thành công', { id: newAccountId });
        } catch (error) {
            next(error);
        }
    },

    // 3. Cập nhật tài khoản
    updateAccount: async (req, res, next) => {
        try {
            const { id } = req.params;
            const { full_name, phone, role_id, branch_id } = req.body;

            if (!full_name || !role_id) {
                return sendResponse(res, 400, false, 'Họ tên và vai trò là bắt buộc');
            }

            // Không cho phép sửa thông tin của tài khoản "admin" gốc (hardcoded bảo vệ)
            if (parseInt(id) === 1) { // Giả sử ID=1 là admin tối cao, có thể đổi logic này
                return sendResponse(res, 403, false, 'Không thể chỉnh sửa tài khoản Admin hệ thống');
            }

            await AccountModel.update(id, { full_name, phone, role_id, branch_id });

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
    },

    getMe: async (req, res, next) => {
        try {
            const pool = require('../config/database');
            const [rows] = await pool.query(`
                SELECT a.account_id, a.full_name, a.email, a.phone, a.is_active, a.created_at, 
                       r.role_name as role, b.branch_name, b.branch_id
                FROM accounts a
                JOIN roles r ON a.role_id = r.role_id
                LEFT JOIN branches b ON a.branch_id = b.branch_id
                WHERE a.account_id = ?
            `, [req.user.id]);
            
            if (rows.length === 0) return sendResponse(res, 404, false, 'Không tìm thấy tài khoản');
            sendResponse(res, 200, true, 'Lấy thông tin thành công', rows[0]);
        } catch (error) {
            next(error);
        }
    },

    updateMe: async (req, res, next) => {
        try {
            const { full_name, phone, password } = req.body;
            const pool = require('../config/database');
            
            if (!full_name) {
                return sendResponse(res, 400, false, 'Họ tên là bắt buộc');
            }

            if (password) {
                const salt = await bcrypt.genSalt(10);
                const password_hash = await bcrypt.hash(password, salt);
                await pool.query('UPDATE accounts SET full_name = ?, phone = ?, password_hash = ? WHERE account_id = ?', [full_name, phone, password_hash, req.user.id]);
            } else {
                await pool.query('UPDATE accounts SET full_name = ?, phone = ? WHERE account_id = ?', [full_name, phone, req.user.id]);
            }

            AccountModel.logActivity({
                account_id: req.user.id,
                action: 'UPDATE_PROFILE',
                target_table: 'accounts',
                target_id: req.user.id,
                description: `Tự cập nhật thông tin cá nhân`,
                ip_address: req.ip || req.connection?.remoteAddress
            }).catch(console.error);

            sendResponse(res, 200, true, 'Cập nhật thông tin thành công');
        } catch (error) {
            next(error);
        }
    }
};

module.exports = AccountController;
