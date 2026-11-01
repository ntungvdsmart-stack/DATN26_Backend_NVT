const pool = require('./database');

/**
 * Đồng bộ cấu trúc bổ sung từ schema chuẩn, rồi chạy migration dữ liệu theo phiên bản.
 * Chạy trước khi nhận request; khóa liên tiến trình được giữ đến khi hoàn tất.
 * `after`: câu lệnh chạy thêm NGAY SAU khi cột vừa được tạo (VD: backfill dữ liệu cũ).
 */
const COLUMNS = [
    { table: 'accounts', column: 'auth_version', ddl: 'ALTER TABLE accounts ADD COLUMN auth_version INT NOT NULL DEFAULT 0' },
    { table: 'customers', column: 'auth_version', ddl: 'ALTER TABLE customers ADD COLUMN auth_version INT NOT NULL DEFAULT 0' },
    { table: 'products', column: 'size_guide_image_url', ddl: 'ALTER TABLE products ADD COLUMN size_guide_image_url VARCHAR(500) NULL' },
    { table: 'product_variants', column: 'size_description', ddl: 'ALTER TABLE product_variants ADD COLUMN size_description TEXT NULL' },
    { table: 'accounts', column: 'username', ddl: 'ALTER TABLE accounts ADD COLUMN username VARCHAR(50) NULL UNIQUE' },
    { table: 'chat_messages', column: 'sender_id', ddl: 'ALTER TABLE chat_messages ADD COLUMN sender_id INT NULL' },
    { table: 'branches', column: 'latitude', ddl: 'ALTER TABLE branches ADD COLUMN latitude DECIMAL(10,7) NULL' },
    { table: 'branches', column: 'longitude', ddl: 'ALTER TABLE branches ADD COLUMN longitude DECIMAL(10,7) NULL' },
    { table: 'customer_addresses', column: 'latitude', ddl: 'ALTER TABLE customer_addresses ADD COLUMN latitude DECIMAL(10,7) NULL' },
    { table: 'customer_addresses', column: 'longitude', ddl: 'ALTER TABLE customer_addresses ADD COLUMN longitude DECIMAL(10,7) NULL' },
    { table: 'orders', column: 'shipping_latitude', ddl: 'ALTER TABLE orders ADD COLUMN shipping_latitude DECIMAL(10,7) NULL' },
    { table: 'orders', column: 'shipping_longitude', ddl: 'ALTER TABLE orders ADD COLUMN shipping_longitude DECIMAL(10,7) NULL' },
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

const ensureSchema = async () => {
    const summary = { columns: [], indexes: [], migrations: [] };
    let portable;
    try {
        portable = await require('./portableSchema').ensurePortableSchema();
        Object.assign(summary, portable.summary);
        for (const { table, column, ddl, after } of COLUMNS) {
            const [rows] = await pool.query(
                `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
                [table, column]
            );
            if (Number(rows[0].cnt) === 0) {
                await pool.query(ddl);
                if (after) await pool.query(after);
                summary.columns.push(`${table}.${column}`);
                console.log(`[ensureSchema] Đã thêm cột ${table}.${column}`);
            } else if (after && summary.columns.includes(`${table}.${column}`)) {
                await pool.query(after);
            }
        }
        const { PERMISSIONS, DEFAULT_GRANTS } = require('./permissions');
        const [existingPermissions] = await pool.query('SELECT permission_code FROM permissions');
        const permissionCodes = new Set(existingPermissions.map(row => row.permission_code));
        for (const [code, description] of Object.entries(PERMISSIONS)) {
            if (!permissionCodes.has(code)) await pool.query('INSERT INTO permissions (permission_code, description) VALUES (?, ?)', [code, description]);
        }
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [featuredMigration] = await connection.query("SELECT migration_key FROM schema_migrations WHERE migration_key = 'featured-categories-v1'");
            if (!featuredMigration.length) {
                const [[featured]] = await connection.query('SELECT COUNT(*) AS count FROM categories WHERE is_featured = 1');
                if (!Number(featured.count)) {
                    for (const [index, [name, image]] of require('./featuredCategoryDefaults').entries()) {
                        const [[category]] = await connection.query('SELECT category_id FROM categories WHERE category_name = ? AND parent_id IS NULL LIMIT 1', [name]);
                        if (category) await connection.query('UPDATE categories SET image_url = COALESCE(image_url, ?), is_featured = 1, display_order = ? WHERE category_id = ?', [image, index, category.category_id]);
                        else await connection.query('INSERT INTO categories (category_name, image_url, is_featured, display_order) VALUES (?, ?, 1, ?)', [name, image, index]);
                    }
                }
                await connection.query("INSERT INTO schema_migrations (migration_key) VALUES ('featured-categories-v1')");
                summary.migrations.push('featured-categories-v1');
            }
            const [applied] = await connection.query("SELECT migration_key FROM schema_migrations WHERE migration_key = 'role-permissions-v1' FOR UPDATE");
            if (!applied.length) {
                for (const [roleName, codes] of Object.entries(DEFAULT_GRANTS)) {
                    await connection.query('INSERT IGNORE INTO role_permissions (role_id, permission_id) SELECT r.role_id, p.permission_id FROM roles r CROSS JOIN permissions p WHERE r.role_name = ? AND p.permission_code IN (?)', [roleName, codes]);
                }
                await connection.query("INSERT INTO schema_migrations (migration_key) VALUES ('role-permissions-v1')");
                summary.migrations.push('role-permissions-v1');
            }
            const [unified] = await connection.query("SELECT migration_key FROM schema_migrations WHERE migration_key = 'unified-staff-v2' FOR UPDATE");
            if (!unified.length) {
                await connection.query("INSERT INTO roles (role_id, role_name) VALUES (2, 'Staff') ON DUPLICATE KEY UPDATE role_name = 'Staff'");
                await connection.query('UPDATE accounts SET role_id = 2 WHERE role_id IN (3, 4)');
                await connection.query('DELETE FROM role_permissions WHERE role_id IN (2, 3, 4)');
                await connection.query('DELETE FROM roles WHERE role_id IN (3, 4)');
                await connection.query('INSERT INTO role_permissions (role_id, permission_id) SELECT 2, permission_id FROM permissions WHERE permission_code IN (?)', [DEFAULT_GRANTS.Staff]);
                await connection.query("INSERT INTO schema_migrations (migration_key) VALUES ('unified-staff-v2')");
                summary.migrations.push('unified-staff-v2');
            }
            const [portableVersion] = await connection.query("SELECT migration_key FROM schema_migrations WHERE migration_key = 'portable-schema-v3'");
            if (!portableVersion.length) {
                await connection.query("INSERT INTO schema_migrations (migration_key) VALUES ('portable-schema-v3')");
                summary.migrations.push('portable-schema-v3');
            }
            await connection.commit();
        } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
        return summary;
    } catch (err) {
        console.error('[ensureSchema] Lỗi kiểm tra schema:', err.message);
        throw err;
    } finally {
        if (portable) await portable.release();
    }
};

module.exports = ensureSchema;
