const pool = require('../config/database');

const AccountModel = {
    // Tìm user bằng email — truy vấn UNION tối ưu (1 câu SQL duy nhất thay vì 2)
    // Chỉ SELECT các cột cần thiết, KHÔNG dùng SELECT *
    findUserByEmail: async (email) => {
        const [rows] = await pool.query(`
            (SELECT 
                customer_id AS id, full_name, email, password_hash, 
                NULL AS username, NULL AS role_id, NULL AS branch_id, NULL AS is_active,
                'customer' AS source
            FROM customers WHERE email = ? LIMIT 1)
            UNION ALL
            (SELECT 
                account_id AS id, full_name, email, password_hash, 
                username, role_id, branch_id, is_active,
                'account' AS source
            FROM accounts WHERE email = ? LIMIT 1)
            LIMIT 1
        `, [email, email]);
        return rows[0] || null;
    },

    // Tìm theo username hoặc email (backup cho trường hợp cần)
    findByEmailOrUsername: async (identifier) => {
        const [rows] = await pool.query(
            'SELECT account_id, username, full_name, email, password_hash, role_id, branch_id, is_active FROM accounts WHERE email = ? OR username = ? LIMIT 1',
            [identifier, identifier]
        );
        return rows[0] || null;
    },

    // Ghi nhật ký hoạt động (fire-and-forget, không chặn luồng chính)
    logActivity: async (logData) => {
        const { account_id, action, target_table = null, target_id = null, description = null, ip_address = null } = logData;
        await pool.query(
            'INSERT INTO activity_logs (account_id, action, target_table, target_id, description, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
            [account_id, action, target_table, target_id, description, ip_address]
        );
    },
    // --- QUẢN LÝ TÀI KHOẢN NỘI BỘ (CRUD) ---

    // Lấy danh sách tất cả tài khoản nội bộ (Kèm tên Role)
    getAll: async () => {
        const [rows] = await pool.query(`
            SELECT a.account_id, a.username, a.full_name, a.email, a.phone, 
                   a.role_id, r.role_name, a.is_active, a.created_at 
            FROM accounts a
            LEFT JOIN roles r ON a.role_id = r.role_id
            ORDER BY a.created_at DESC
        `);
        return rows;
    },

    // Tạo tài khoản nội bộ mới
    create: async (accountData) => {
        const { username, password_hash, full_name, email, phone, role_id } = accountData;
        const [result] = await pool.query(
            'INSERT INTO accounts (username, password_hash, full_name, email, phone, role_id, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
            [username, password_hash, full_name, email, phone, role_id]
        );
        return result.insertId;
    },

    // Cập nhật thông tin cơ bản
    update: async (accountId, updateData) => {
        const { full_name, phone, role_id } = updateData;
        await pool.query(
            'UPDATE accounts SET full_name = ?, phone = ?, role_id = ? WHERE account_id = ?',
            [full_name, phone, role_id, accountId]
        );
    },

    // Bật/Tắt trạng thái tài khoản (Khóa/Mở khóa)
    toggleStatus: async (accountId, status) => {
        await pool.query(
            'UPDATE accounts SET is_active = ? WHERE account_id = ?',
            [status, accountId]
        );
    },

    // Đặt lại mật khẩu
    resetPassword: async (accountId, newPasswordHash) => {
        await pool.query(
            'UPDATE accounts SET password_hash = ? WHERE account_id = ?',
            [newPasswordHash, accountId]
        );
    }
};

module.exports = AccountModel;
