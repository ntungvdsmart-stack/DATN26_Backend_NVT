const pool = require('../config/database');

const CustomerModel = {
    // Tìm khách hàng theo email — chỉ lấy cột cần thiết
    findByEmail: async (email) => {
        const [rows] = await pool.query(
            'SELECT customer_id, full_name, email, phone, password_hash, customer_type FROM customers WHERE email = ? LIMIT 1',
            [email]
        );
        return rows[0] || null;
    },

    // Tìm khách hàng theo số điện thoại
    findByPhone: async (phone) => {
        const [rows] = await pool.query(
            'SELECT customer_id FROM customers WHERE phone = ? LIMIT 1',
            [phone]
        );
        return rows[0] || null;
    },

    // Kiểm tra email đã tồn tại chưa (ở CẢ 2 bảng, dùng 1 truy vấn UNION)
    checkEmailExists: async (email) => {
        const [rows] = await pool.query(`
            (SELECT 1 FROM customers WHERE email = ? LIMIT 1)
            UNION ALL
            (SELECT 1 FROM accounts WHERE email = ? LIMIT 1)
            LIMIT 1
        `, [email, email]);
        return rows.length > 0;
    },

    // Tạo tài khoản khách hàng mới
    create: async (customerData) => {
        const { full_name, phone, email, password_hash, customer_type = 'online' } = customerData;
        const [result] = await pool.query(
            'INSERT INTO customers (full_name, phone, email, password_hash, customer_type) VALUES (?, ?, ?, ?, ?)',
            [full_name, phone || null, email, password_hash, customer_type]
        );
        return result.insertId;
    }
};

module.exports = CustomerModel;
