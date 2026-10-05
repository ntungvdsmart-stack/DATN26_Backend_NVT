require('dotenv').config();
const pool = require('./src/config/database');

async function createTable() {
    try {
        const query = `
            CREATE TABLE IF NOT EXISTS system_settings (
                setting_key VARCHAR(100) PRIMARY KEY,
                setting_value TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `;
        await pool.query(query);
        console.log("✅ Bảng 'system_settings' đã được tạo thành công.");
        
        const defaultSettings = [
            ['store_name', 'My Fashion Store'],
            ['tax_rate', '10'],
            ['currency', 'VND']
        ];
        
        for (const [key, value] of defaultSettings) {
             await pool.query(
                'INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
                [key, String(value), String(value)]
              );
        }
        console.log("✅ Các cài đặt mặc định đã được thêm.");
    } catch (error) {
        console.error("❌ Lỗi khi tạo bảng:", error);
    } finally {
        process.exit();
    }
}

createTable();
