const mysql = require('mysql2/promise');
const cloudinary = require('cloudinary').v2;
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'fashion_multichannel',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function run() {
    try {
        console.log("🚀 Đang quét các ảnh chưa thuộc Cloudinary...");
        const [images] = await pool.query("SELECT image_id, image_url FROM product_images WHERE image_url NOT LIKE '%cloudinary.com%'");
        
        if (images.length === 0) {
            console.log("✅ Tất cả ảnh đều đã nằm trên Cloudinary!");
            process.exit(0);
        }

        console.log(`Tìm thấy ${images.length} ảnh cần tải lên Cloudinary. Đang xử lý...`);
        let count = 0;

        for (const img of images) {
            try {
                console.log(`Đang tải ảnh ID ${img.image_id} lên Cloudinary...`);
                
                const result = await cloudinary.uploader.upload(img.image_url, {
                    folder: 'fashionOS/products',
                    public_id: `seed-product-${Date.now()}-${Math.round(Math.random() * 1e6)}`
                });
                
                await pool.query("UPDATE product_images SET image_url = ? WHERE image_id = ?", [result.secure_url, img.image_id]);
                console.log(`✅ Thành công: ID ${img.image_id} -> ${result.secure_url}`);
                count++;
            } catch (err) {
                console.error(`❌ Lỗi tải ảnh ID ${img.image_id}:`, err.message);
            }
        }
        
        console.log(`🎉 Hoàn tất! Đã đưa thành công ${count}/${images.length} ảnh lên Cloudinary.`);
        process.exit(0);
    } catch (error) {
        console.error("Lỗi hệ thống:", error);
        process.exit(1);
    }
}

run();
