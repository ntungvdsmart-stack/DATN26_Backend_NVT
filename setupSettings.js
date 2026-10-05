require('dotenv').config();
const pool = require('./src/config/database');

async function setupSettingsTable() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS system_settings (
                setting_key VARCHAR(100) PRIMARY KEY,
                setting_value TEXT
            ) ENGINE=InnoDB;
        `);
        console.log('✅ Bảng system_settings đã sẵn sàng.');

        await pool.query(`
            INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES 
            ('store_name', 'FashionOS'), 
            ('store_address', '123 Đường Fashion, Quận 1, TP.HCM'), 
            ('store_email', 'contact@fashion.com'), 
            ('store_phone', '0123456789'), 
            ('tax_rate', '10')
        `);
        console.log('✅ Đã khởi tạo dữ liệu mẫu cho system_settings.');

        process.exit(0);
    } catch (error) {
        console.error('❌ Lỗi:', error);
        process.exit(1);
    }
}

setupSettingsTable();
