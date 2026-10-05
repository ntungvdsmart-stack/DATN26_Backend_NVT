const pool = require('./database');

/**
 * Tự động bổ sung các cột còn thiếu phục vụ luồng đơn hàng + tích điểm (idempotent).
 * Chạy 1 lần khi server khởi động, an toàn nếu cột đã tồn tại.
 * `after`: câu lệnh chạy thêm NGAY SAU khi cột vừa được tạo (VD: backfill dữ liệu cũ).
 */
const COLUMNS = [
    { table: 'orders', column: 'shipping_fee', ddl: 'ALTER TABLE orders ADD COLUMN shipping_fee DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER discount_amount' },
    { table: 'orders', column: 'note', ddl: 'ALTER TABLE orders ADD COLUMN note VARCHAR(500) NULL' },
    { table: 'orders', column: 'loyalty_discount', ddl: 'ALTER TABLE orders ADD COLUMN loyalty_discount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER discount_amount' },
    { table: 'orders', column: 'points_earned', ddl: 'ALTER TABLE orders ADD COLUMN points_earned INT NOT NULL DEFAULT 0' },
    { table: 'payments', column: 'paid_at', ddl: 'ALTER TABLE payments ADD COLUMN paid_at DATETIME NULL' },
    { table: 'customers', column: 'is_active', ddl: 'ALTER TABLE customers ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1' },
    {
        table: 'customers', column: 'loyalty_points',
        ddl: 'ALTER TABLE customers ADD COLUMN loyalty_points INT NOT NULL DEFAULT 0',
        // Quy đổi điểm cho các đơn đã hoàn thành trước khi có tính năng tích điểm (10.000đ = 1 điểm)
        after: `UPDATE customers c SET c.loyalty_points = (
                    SELECT COALESCE(FLOOR(SUM(o.total_amount) / 10000), 0) FROM orders o
                    WHERE o.customer_id = c.customer_id AND o.order_status = 'completed')`
    }
];

const INDEXES = [
    { table: 'orders', name: 'idx_orders_staff_created', ddl: 'CREATE INDEX idx_orders_staff_created ON orders (staff_id, created_at)' },
    { table: 'customers', name: 'idx_customers_phone', ddl: 'CREATE INDEX idx_customers_phone ON customers (phone)' }
];

const ensureSchema = async () => {
    try {
        for (const { table, column, ddl, after } of COLUMNS) {
            const [rows] = await pool.query(
                `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
                [table, column]
            );
            if (Number(rows[0].cnt) === 0) {
                await pool.query(ddl);
                if (after) await pool.query(after);
                console.log(`[ensureSchema] Đã thêm cột ${table}.${column}`);
            }
        }
        for (const { table, name, ddl } of INDEXES) {
            const [rows] = await pool.query(
                `SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
                [table, name]
            );
            if (Number(rows[0].cnt) === 0) {
                await pool.query(ddl).catch(() => {});
            }
        }
    } catch (err) {
        console.error('[ensureSchema] Lỗi kiểm tra schema:', err.message);
    }
};

module.exports = ensureSchema;
