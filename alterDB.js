require('dotenv').config();
const pool = require('./src/config/database');

async function run() {
  try {
    // 1. Thêm cột size_description vào product_variants
    await pool.query('ALTER TABLE product_variants ADD COLUMN size_description VARCHAR(200) NULL AFTER size_id');
    console.log('✅ Đã thêm cột size_description vào product_variants');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log('⚠️ Cột size_description đã tồn tại, bỏ qua.');
    } else {
      console.error('Lỗi:', err.message);
    }
  }

  try {
    // 2. Dọn sizes table về dạng đơn giản (xóa phần mô tả trong ngoặc)
    const [sizes] = await pool.query('SELECT size_id, size_value FROM sizes');
    for (const s of sizes) {
      const match = s.size_value.match(/^([^(]+?)(?:\s*\(.+\))?$/);
      const cleanLabel = match ? match[1].trim() : s.size_value;
      if (cleanLabel !== s.size_value) {
        await pool.query('UPDATE sizes SET size_value = ? WHERE size_id = ?', [cleanLabel, s.size_id]);
        console.log(`  Cleaned: "${s.size_value}" → "${cleanLabel}"`);
      }
    }
    console.log('✅ Đã dọn dẹp bảng sizes về nhãn đơn giản');
  } catch (err) {
    console.error('Lỗi dọn sizes:', err.message);
  }

  process.exit(0);
}

run();
