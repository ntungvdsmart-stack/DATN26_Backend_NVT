const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'fashion_multichannel',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function getOrInsert(table, column, value, extraCols = {}, extraVals = []) {
    const [rows] = await pool.query(`SELECT * FROM ${table} WHERE ${column} = ?`, [value]);
    if (rows.length > 0) return rows[0][`${table.slice(0,-1)}_id`] || rows[0].category_id || rows[0].brand_id || rows[0].size_id || rows[0].color_id || rows[0].material_id;
    
    const cols = [column, ...Object.keys(extraCols)].join(', ');
    const qMarks = ['?', ...Object.keys(extraCols).map(() => '?')].join(', ');
    const values = [value, ...Object.values(extraCols)];
    
    const [res] = await pool.query(`INSERT INTO ${table} (${cols}) VALUES (${qMarks})`, values);
    return res.insertId;
}

const fakeStoreImages = [
  'https://fakestoreapi.com/img/81fPKd-2AYL._AC_SL1500_.jpg',
  'https://fakestoreapi.com/img/71-3HjGNDUL._AC_SY879._SX._UX._SY._UY_.jpg',
  'https://fakestoreapi.com/img/71li-ujtlVG._AC_UX679_.jpg',
  'https://fakestoreapi.com/img/71YXzeOuslL._AC_UY879_.jpg',
  'https://fakestoreapi.com/img/51Y5NI-I5jL._AC_UX679_.jpg',
  'https://fakestoreapi.com/img/81XH0e8fefL._AC_UY879_.jpg',
  'https://fakestoreapi.com/img/71HblAHs5xL._AC_UY879_-2.jpg'
];

const productsSeed = Array.from({ length: 14 }).map((_, i) => ({
    name: `Sản Phẩm Thời Trang ${i + 7} Cao Cấp`,
    desc: `Mô tả chi tiết cho sản phẩm thời trang ${i + 7}. Form dáng hiện đại, chất liệu mềm mại, rất phù hợp mặc hàng ngày.`,
    category: ["Áo Thun", "Quần Jeans", "Áo Khoác", "Váy Đầm", "Phụ Kiện", "Áo Sơ Mi"][i % 6],
    brand: ["Zara", "H&M", "Gucci", "Uniqlo", "Levi's", "Adidas"][i % 6],
    price: Math.floor(Math.random() * 10 + 2) * 100000,
    images: [
        { url: fakeStoreImages[i % fakeStoreImages.length], is_primary: true, color: "Trắng" },
        { url: fakeStoreImages[(i + 1) % fakeStoreImages.length], is_primary: false, color: "Đen" }
    ],
    variants: [
        { size: "S", colors: ["Trắng", "Đen"], qty: Math.floor(Math.random() * 50) + 10 },
        { size: "M", colors: ["Trắng", "Đen"], qty: Math.floor(Math.random() * 50) + 20 },
        { size: "L", colors: ["Trắng"], qty: Math.floor(Math.random() * 30) + 10 }
    ]
}));

const colorHex = {
    "Trắng": "#FFFFFF", "Đen": "#000000", "Đỏ": "#FF0000",
    "Xanh dương": "#0000FF", "Nâu": "#8B4513", "Vàng": "#FFFF00", "Xám": "#808080"
};

async function runSeed() {
    try {
        console.log("🚀 Đang chạy thêm 14 sản phẩm...");
        
        const connection = await pool.getConnection();
        
        for (const p of productsSeed) {
            console.log(`Đang xử lý sản phẩm: ${p.name}`);
            
            const catId = await getOrInsert('categories', 'category_name', p.category);
            const brandId = await getOrInsert('brands', 'brand_name', p.brand);
            
            const [pRes] = await connection.query(
                'INSERT INTO products (product_name, description, category_id, brand_id, base_price, is_active) VALUES (?, ?, ?, ?, ?, 1)',
                [p.name, p.desc, catId, brandId, p.price]
            );
            const productId = pRes.insertId;
            
            const colorIdMap = {};
            let variantCount = 0;
            for (const vGroup of p.variants) {
                const sizeId = await getOrInsert('sizes', 'size_value', vGroup.size);
                for (const color of vGroup.colors) {
                    const cId = await getOrInsert('colors', 'color_name', color, { hex_code: colorHex[color] || '#000000' });
                    colorIdMap[color] = cId;
                    
                    const sku = `SKU-${productId}-${sizeId}-${cId}`;
                    const [vRes] = await connection.query(
                        'INSERT INTO product_variants (product_id, sku, size_id, color_id, price) VALUES (?, ?, ?, ?, ?)',
                        [productId, sku, sizeId, cId, p.price]
                    );
                    
                    await connection.query(
                        'INSERT INTO inventory (variant_id, branch_id, quantity) VALUES (?, 1, ?)',
                        [vRes.insertId, vGroup.qty]
                    );
                    variantCount++;
                }
            }
            
            let sortOrder = 0;
            for (const img of p.images) {
                const cId = colorIdMap[img.color];
                const [vRows] = await connection.query('SELECT variant_id FROM product_variants WHERE product_id = ? AND color_id = ? LIMIT 1', [productId, cId]);
                const vId = vRows.length > 0 ? vRows[0].variant_id : null;
                
                await connection.query(
                    'INSERT INTO product_images (product_id, variant_id, image_url, is_primary, sort_order) VALUES (?, ?, ?, ?, ?)',
                    [productId, vId, img.url, img.is_primary ? 1 : 0, sortOrder++]
                );
            }
            console.log(`✅ Hoàn tất: ${p.name} (${variantCount} biến thể)`);
        }
        
        connection.release();
        console.log("🎉 SEED THÀNH CÔNG! Đã có thêm 14 sản phẩm.");
        process.exit(0);
    } catch (error) {
        console.error("❌ Lỗi khi seed dữ liệu:", error);
        process.exit(1);
    }
}

runSeed();
