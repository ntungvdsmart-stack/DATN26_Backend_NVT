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
            'SELECT customer_id, password_hash, email FROM customers WHERE phone = ? LIMIT 1',
            [phone]
        );
        return rows[0] || null;
    },

    // Liên kết tài khoản cho khách vãng lai đã có ở POS
    updateAccountForPosCustomer: async (customer_id, customerData) => {
        const { full_name, email, password_hash } = customerData;
        await pool.query(
            'UPDATE customers SET full_name = ?, email = ?, password_hash = ?, customer_type = "online" WHERE customer_id = ?',
            [full_name, email, password_hash, customer_id]
        );
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
            [full_name, phone || null, email, password_hash || null, customer_type]
        );
        return result.insertId;
    },

    // ── Admin Features ───────────────────────────────────────────────────────

    // Lấy tất cả khách hàng kèm thống kê
    getAllCustomersAdmin: async () => {
        const [rows] = await pool.query(`
            SELECT 
                c.customer_id, c.full_name, c.email, c.phone, c.customer_type, 
                c.is_active, c.created_at, c.loyalty_points,
                COUNT(o.order_id) AS total_orders,
                COALESCE(SUM(o.total_amount), 0) AS total_spent
            FROM customers c
            LEFT JOIN orders o ON c.customer_id = o.customer_id AND o.order_status = 'completed'
            GROUP BY c.customer_id
            ORDER BY c.created_at DESC
        `);
        return rows;
    },

    // Xem chi tiết khách hàng và lịch sử đơn hàng
    getCustomerById: async (id) => {
        const [customers] = await pool.query(`
            SELECT 
                c.customer_id, c.full_name, c.email, c.phone, c.customer_type, 
                c.is_active, c.created_at, c.loyalty_points,
                COUNT(o.order_id) AS total_orders,
                COALESCE(SUM(o.total_amount), 0) AS total_spent
            FROM customers c
            LEFT JOIN orders o ON c.customer_id = o.customer_id AND o.order_status = 'completed'
            WHERE c.customer_id = ?
            GROUP BY c.customer_id
        `, [id]);
        
        if (customers.length === 0) return null;
        const customer = customers[0];

        // Lấy lịch sử 10 đơn hàng gần nhất
        const [orders] = await pool.query(`
            SELECT order_id, order_code, channel, order_status, total_amount, created_at
            FROM orders
            WHERE customer_id = ?
            ORDER BY created_at DESC
            LIMIT 10
        `, [id]);

        customer.recent_orders = orders;
        return customer;
    },

    // Khóa / Mở khóa tài khoản
    updateCustomerStatus: async (id, isActive) => {
        const [result] = await pool.query(
            'UPDATE customers SET is_active = ? WHERE customer_id = ?',
            [isActive ? 1 : 0, id]
        );
        return result.affectedRows > 0;
    },

    // ── Customer Self-Service ────────────────────────────────────────────

    // Lấy thông tin cá nhân (cho chính khách hàng đã đăng nhập)
    getProfile: async (customerId) => {
        const [rows] = await pool.query(`
            SELECT 
                c.customer_id, c.full_name, c.email, c.phone, c.customer_type, 
                c.is_active, c.created_at,
                COUNT(o.order_id) AS total_orders,
                COALESCE(SUM(CASE WHEN o.order_status = 'completed' THEN o.total_amount ELSE 0 END), 0) AS total_spent
            FROM customers c
            LEFT JOIN orders o ON c.customer_id = o.customer_id
            WHERE c.customer_id = ?
            GROUP BY c.customer_id
        `, [customerId]);
        return rows[0] || null;
    },

    // Cập nhật thông tin cá nhân
    updateProfile: async (customerId, data) => {
        const { full_name, phone } = data;
        const [result] = await pool.query(
            'UPDATE customers SET full_name = ?, phone = ? WHERE customer_id = ?',
            [full_name, phone || null, customerId]
        );
        return result.affectedRows > 0;
    },

    // Lấy password hash (dùng cho đổi mật khẩu)
    getPasswordHash: async (customerId) => {
        const [rows] = await pool.query(
            'SELECT password_hash FROM customers WHERE customer_id = ?',
            [customerId]
        );
        return rows[0]?.password_hash || null;
    },

    // Đổi mật khẩu
    updatePassword: async (customerId, newPasswordHash) => {
        const [result] = await pool.query(
            'UPDATE customers SET password_hash = ? WHERE customer_id = ?',
            [newPasswordHash, customerId]
        );
        return result.affectedRows > 0;
    },

    // Lấy lịch sử đơn hàng của chính khách hàng (có phân trang)
    getMyOrders: async (customerId) => {
        const [orders] = await pool.query(`
            SELECT 
                o.order_id, o.order_code, o.channel, o.order_status, 
                o.subtotal_amount, o.discount_amount, o.total_amount, o.shipping_fee,
                MAX(p.payment_method) AS payment_method, MAX(p.payment_status) AS payment_status, o.shipping_address_snapshot,
                o.created_at, o.updated_at,
                COUNT(oi.order_item_id) as total_items
            FROM orders o
            LEFT JOIN order_items oi ON o.order_id = oi.order_id
            LEFT JOIN payments p ON o.order_id = p.order_id
            WHERE o.customer_id = ?
            GROUP BY o.order_id
            ORDER BY o.created_at DESC
        `, [customerId]);
        return orders;
    },

    // Lấy chi tiết 1 đơn hàng kèm danh sách sản phẩm (chỉ nếu thuộc khách hàng đó)
    getMyOrderDetail: async (customerId, orderId) => {
        const [orders] = await pool.query(`
            SELECT 
                o.order_id, o.order_code, o.channel, o.order_status, 
                o.subtotal_amount, o.discount_amount, o.total_amount, o.shipping_fee,
                p.payment_method, p.payment_status, o.shipping_address_snapshot,
                o.created_at, o.updated_at
            FROM orders o
            LEFT JOIN payments p ON o.order_id = p.order_id
            WHERE o.order_id = ? AND o.customer_id = ?
        `, [orderId, customerId]);

        if (orders.length === 0) return null;
        const order = orders[0];

        const [items] = await pool.query(`
            SELECT 
                oi.order_item_id, oi.variant_id, oi.quantity, oi.unit_price,
                p.product_name,
                s.size_value, cl.color_name,
                (SELECT image_url FROM product_images pi WHERE pi.product_id = p.product_id AND pi.is_primary = 1 LIMIT 1) as image_url
            FROM order_items oi
            LEFT JOIN product_variants v ON oi.variant_id = v.variant_id
            LEFT JOIN products p ON v.product_id = p.product_id
            LEFT JOIN sizes s ON v.size_id = s.size_id
            LEFT JOIN colors cl ON v.color_id = cl.color_id
            WHERE oi.order_id = ?
        `, [orderId]);

        order.items = items;
        return order;
    }
};

module.exports = CustomerModel;
