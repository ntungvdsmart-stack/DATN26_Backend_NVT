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

const productsSeed = [
    {
        name: "Áo Phông Nam Basic Cotton Cao Cấp",
        desc: "Áo phông basic 100% cotton thoáng mát, thấm hút mồ hôi tốt. Dễ dàng phối đồ cho phong cách trẻ trung năng động.",
        category: "Áo Thun",
        brand: "Uniqlo",
        price: 299000,
        images: [
            { url: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800", is_primary: true, color: "Trắng" },
            { url: "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=800", is_primary: false, color: "Đen" },
            { url: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=800", is_primary: false, color: "Đỏ" }
        ],
        variants: [
            { size: "S", colors: ["Trắng", "Đen", "Đỏ"], qty: 50 },
            { size: "M", colors: ["Trắng", "Đen", "Đỏ"], qty: 100 },
            { size: "L", colors: ["Trắng", "Đen", "Đỏ"], qty: 100 },
            { size: "XL", colors: ["Trắng", "Đen"], qty: 30 }
        ]
    },
    {
        name: "Quần Jeans Nam Slim Fit Tôn Dáng",
        desc: "Quần Jeans chất liệu denim co giãn nhẹ, form slim fit ôm vừa phải, tôn dáng cực tốt, bền màu.",
        category: "Quần Jeans",
        brand: "Levi's",
        price: 850000,
        images: [
            { url: "https://images.unsplash.com/photo-1542272604-787c3835535d?w=800", is_primary: true, color: "Xanh dương" },
            { url: "https://images.unsplash.com/photo-1602293589930-45aad59ba3ab?w=800", is_primary: false, color: "Đen" }
        ],
        variants: [
            { size: "M", colors: ["Xanh dương", "Đen"], qty: 40 },
            { size: "L", colors: ["Xanh dương", "Đen"], qty: 60 },
            { size: "XL", colors: ["Xanh dương", "Đen"], qty: 40 }
        ]
    },
    {
        name: "Áo Khoác Da Biker Nam Cổ Điển",
        desc: "Áo khoác da thật 100%, thiết kế cổ điển mạnh mẽ, lót lụa mềm mại bên trong, chống nước và cản gió tốt.",
        category: "Áo Khoác",
        brand: "Zara",
        price: 1590000,
        images: [
            { url: "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=800", is_primary: true, color: "Đen" },
            { url: "https://images.unsplash.com/photo-1520975954732-57dd22299614?w=800", is_primary: false, color: "Nâu" }
        ],
        variants: [
            { size: "M", colors: ["Đen", "Nâu"], qty: 15 },
            { size: "L", colors: ["Đen", "Nâu"], qty: 20 },
            { size: "XL", colors: ["Đen"], qty: 10 }
        ]
    },
    {
        name: "Váy Liền Nữ Họa Tiết Hoa Nhí Mùa Hè",
        desc: "Váy hoa nhí dáng xòe nữ tính, chất liệu voan lụa 2 lớp mỏng nhẹ, thiết kế cổ V quyến rũ.",
        category: "Váy Đầm",
        brand: "H&M",
        price: 450000,
        images: [
            { url: "https://images.unsplash.com/photo-1572804013309-82a89b4f945c?w=800", is_primary: true, color: "Vàng" },
            { url: "https://images.unsplash.com/photo-1618932260643-eee4a2f652a6?w=800", is_primary: false, color: "Đỏ" }
        ],
        variants: [
            { size: "S", colors: ["Vàng", "Đỏ"], qty: 30 },
            { size: "M", colors: ["Vàng", "Đỏ"], qty: 40 },
            { size: "L", colors: ["Vàng"], qty: 20 }
        ]
    },
    {
        name: "Áo Sơ Mi Trắng Công Sở Nữ Thanh Lịch",
        desc: "Áo sơ mi lụa trắng không nhăn, form dáng chuẩn công sở, thấm hút mồ hôi tốt, không lộ nội y.",
        category: "Áo Sơ Mi",
        brand: "Gucci",
        price: 1200000,
        images: [
            { url: "https://images.unsplash.com/photo-1596783049171-8bc6114eb31a?w=800", is_primary: true, color: "Trắng" }
        ],
        variants: [
            { size: "S", colors: ["Trắng"], qty: 25 },
            { size: "M", colors: ["Trắng"], qty: 35 },
            { size: "L", colors: ["Trắng"], qty: 15 }
        ]
    },
    {
        name: "Áo Hoodie Nam Unisex Form Rộng",
        desc: "Áo hoodie chất nỉ bông ấm áp, form rộng oversize thời thượng, mũ to 2 lớp dày dặn.",
        category: "Áo Nỉ",
        brand: "Adidas",
        price: 650000,
        images: [
            { url: "https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=800", is_primary: true, color: "Xám" },
            { url: "https://images.unsplash.com/photo-1616422285623-aa30d0fb9023?w=800", is_primary: false, color: "Đen" }
        ],
        variants: [
            { size: "M", colors: ["Xám", "Đen"], qty: 50 },
            { size: "L", colors: ["Xám", "Đen"], qty: 60 },
            { size: "XL", colors: ["Xám", "Đen"], qty: 50 },
            { size: "XXL", colors: ["Xám"], qty: 20 }
        ]
    }
];

const colorHex = {
    "Trắng": "#FFFFFF", "Đen": "#000000", "Đỏ": "#FF0000",
    "Xanh dương": "#0000FF", "Nâu": "#8B4513", "Vàng": "#FFFF00", "Xám": "#808080"
};

async function runSeed() {
    try {
        console.log("🚀 Đang chạy seed dữ liệu...");
        
        // Disable foreign keys temporarily
        const connection = await pool.getConnection();
        
        for (const p of productsSeed) {
            console.log(`Đang xử lý sản phẩm: ${p.name}`);
            
            const catId = await getOrInsert('categories', 'category_name', p.category);
            const brandId = await getOrInsert('brands', 'brand_name', p.brand);
            
            // Insert Product
            const [pRes] = await connection.query(
                'INSERT INTO products (product_name, description, category_id, brand_id, base_price, is_active) VALUES (?, ?, ?, ?, ?, 1)',
                [p.name, p.desc, catId, brandId, p.price]
            );
            const productId = pRes.insertId;
            
            const colorIdMap = {};
            // Process Variants
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
                    
                    // Insert inventory (Branch 1)
                    await connection.query(
                        'INSERT INTO inventory (variant_id, branch_id, quantity) VALUES (?, 1, ?)',
                        [vRes.insertId, vGroup.qty]
                    );
                    variantCount++;
                }
            }
            
            // Process Images
            let sortOrder = 0;
            for (const img of p.images) {
                const cId = colorIdMap[img.color];
                // Lấy 1 variant_id của màu này để gán ảnh
                const [vRows] = await connection.query('SELECT variant_id FROM product_variants WHERE product_id = ? AND color_id = ? LIMIT 1', [productId, cId]);
                const vId = vRows.length > 0 ? vRows[0].variant_id : null;
                
                await connection.query(
                    'INSERT INTO product_images (product_id, variant_id, image_url, is_primary, sort_order) VALUES (?, ?, ?, ?, ?)',
                    [productId, vId, img.url, img.is_primary ? 1 : 0, sortOrder++]
                );
            }
            console.log(`✅ Hoàn tất: ${p.name} (${variantCount} biến thể, ${p.images.length} ảnh)`);
        }
        
        connection.release();
        console.log("🎉 SEED THÀNH CÔNG!");
        process.exit(0);
    } catch (error) {
        console.error("❌ Lỗi khi seed dữ liệu:", error);
        process.exit(1);
    }
}

runSeed();
