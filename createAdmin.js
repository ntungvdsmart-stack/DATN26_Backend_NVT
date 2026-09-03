/**
 * SCRIPT TẠO DỮ LIỆU MẪU BAN ĐẦU (Seed Script)
 * ------------------------------------------------
 * Chạy lệnh: node createAdmin.js
 *
 * Script sẽ tạo:
 *   1. Roles: Admin, NV_Online, NV_POS, NV_Kho
 *   2. Branch mặc định: Kho Tổng + Chi nhánh 1
 *   3. Tài khoản Admin:  admin / admin123
 *   4. Tài khoản Staff:  staff1 / 123
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./src/config/database');

async function seed() {
    try {
        console.log('\n🚀 Bắt đầu tạo dữ liệu mẫu...\n');

        // ─────────────────────────────────────────
        // 1. Tạo Roles
        // ─────────────────────────────────────────
        const rolesToInsert = ['Admin', 'NV_Online', 'NV_POS', 'NV_Kho'];
        for (const roleName of rolesToInsert) {
            await pool.query(
                `INSERT IGNORE INTO roles (role_name) VALUES (?)`,
                [roleName]
            );
        }
        const [roles] = await pool.query(`SELECT role_id, role_name FROM roles`);
        const roleMap = Object.fromEntries(roles.map(r => [r.role_name, r.role_id]));
        console.log('✅ Roles:', Object.keys(roleMap).join(', '));

        // ─────────────────────────────────────────
        // 2. Tạo Branches
        // ─────────────────────────────────────────
        await pool.query(
            `INSERT IGNORE INTO branches (branch_id, branch_name, address, phone) VALUES
             (1, 'Kho Tổng / Trung Tâm', 'Hà Nội', NULL),
             (2, 'Chi nhánh 1 - HCM', 'TP. Hồ Chí Minh', NULL)`
        );
        console.log('✅ Branches: Kho Tổng (ID=1), Chi nhánh HCM (ID=2)');

        // ─────────────────────────────────────────
        // 3. Tạo tài khoản Admin
        // ─────────────────────────────────────────
        await pool.query(
            `DELETE FROM accounts WHERE username = 'admin' OR email = 'admin@gmail.com'`
        );
        const adminHash = await bcrypt.hash('admin123', 10);
        await pool.query(
            `INSERT INTO accounts (username, password_hash, full_name, email, phone, role_id, branch_id, is_active)
             VALUES (?, ?, ?, ?, ?, ?, NULL, 1)`,
            ['admin', adminHash, 'System Administrator', 'admin@gmail.com', '0123456789', roleMap['Admin']]
        );
        console.log('✅ Admin    → username: admin       | password: admin123');

        // ─────────────────────────────────────────
        // 4. Tạo tài khoản Staff mẫu
        // ─────────────────────────────────────────
        await pool.query(
            `DELETE FROM accounts WHERE username = 'staff1'`
        );
        const staffHash = await bcrypt.hash('123', 10);
        await pool.query(
            `INSERT INTO accounts (username, password_hash, full_name, email, phone, role_id, branch_id, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
            ['staff1', staffHash, 'Nhân viên Demo', 'staff1@fashionos.com', '0987654321', roleMap['NV_Online'], 1]
        );
        console.log('✅ Staff    → username: staff1      | password: 123');

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🎉 Seed hoàn tất! Thông tin đăng nhập:');
        console.log('   Admin : admin@gmail.com  hoặc  admin   / admin123');
        console.log('   Staff : staff1@fashionos.com  hoặc  staff1  / 123');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        process.exit(0);
    } catch (error) {
        console.error('\n❌ Lỗi seed:', error.message);
        console.error(error);
        process.exit(1);
    }
}

seed();
