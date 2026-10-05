const pool = require('../config/database');

const ProductModel = {
    // 1. Lấy danh sách sản phẩm (kèm số lượng biến thể và tổng tồn kho)
    getAll: async () => {
        const [rows] = await pool.query(`
            SELECT 
                p.product_id, p.product_name, p.base_price, p.is_active, p.created_at,
                c.category_name, b.brand_name,
                COUNT(DISTINCT v.variant_id) as total_variants,
                COALESCE(SUM(i.quantity), 0) as total_inventory,
                (SELECT image_url FROM product_images pi WHERE pi.product_id = p.product_id AND pi.is_primary = 1 LIMIT 1) as primary_image
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.category_id
            LEFT JOIN brands b ON p.brand_id = b.brand_id
            LEFT JOIN product_variants v ON p.product_id = v.product_id
            LEFT JOIN inventory i ON v.variant_id = i.variant_id
            GROUP BY p.product_id
            ORDER BY p.created_at DESC
        `);
        return rows;
    },

    // 2. Lấy chi tiết 1 sản phẩm (kèm variants + images)
    getById: async (productId) => {
        const [products] = await pool.query(`
            SELECT p.*, c.category_name, b.brand_name 
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.category_id
            LEFT JOIN brands b ON p.brand_id = b.brand_id
            WHERE p.product_id = ?
        `, [productId]);

        if (products.length === 0) return null;
        const product = products[0];

        const [variants] = await pool.query(`
            SELECT v.variant_id, v.sku, v.price, v.is_active, v.size_description,
                   s.size_id, s.size_value,
                   c.color_id, c.color_name, c.hex_code,
                   m.material_id, m.material_name,
                   COALESCE(SUM(i.quantity), 0) as inventory_quantity
            FROM product_variants v
            LEFT JOIN sizes s ON v.size_id = s.size_id
            LEFT JOIN colors c ON v.color_id = c.color_id
            LEFT JOIN materials m ON v.material_id = m.material_id
            LEFT JOIN inventory i ON v.variant_id = i.variant_id
            WHERE v.product_id = ?
            GROUP BY v.variant_id
        `, [productId]);

        const [images] = await pool.query(`
            SELECT image_id, variant_id, image_url, is_primary, sort_order
            FROM product_images WHERE product_id = ?
            ORDER BY is_primary DESC, sort_order ASC
        `, [productId]);

        product.variants = variants;
        product.images = images;
        return product;
    },

    // 2.1 Lấy danh sách sản phẩm public (chỉ lấy is_active = 1)
    getPublicProducts: async () => {
        const [rows] = await pool.query(`
            SELECT 
                p.product_id, p.product_name, p.base_price, p.created_at,
                c.category_name, b.brand_name,
                (SELECT image_url FROM product_images pi WHERE pi.product_id = p.product_id AND pi.is_primary = 1 LIMIT 1) as primary_image
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.category_id
            LEFT JOIN brands b ON p.brand_id = b.brand_id
            WHERE p.is_active = 1
            ORDER BY p.created_at DESC
        `);
        return rows;
    },

    // 2.2 Lấy chi tiết sản phẩm public (chỉ is_active = 1)
    getPublicProductDetails: async (productId) => {
        const [products] = await pool.query(`
            SELECT p.*, c.category_name, b.brand_name 
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.category_id
            LEFT JOIN brands b ON p.brand_id = b.brand_id
            WHERE p.product_id = ? AND p.is_active = 1
        `, [productId]);

        if (products.length === 0) return null;
        const product = products[0];

        const [variants] = await pool.query(`
            SELECT v.variant_id, v.sku, v.price, v.size_description,
                   s.size_id, s.size_value,
                   c.color_id, c.color_name, c.hex_code,
                   m.material_id, m.material_name,
                   COALESCE(SUM(i.quantity), 0) as inventory_quantity
            FROM product_variants v
            LEFT JOIN sizes s ON v.size_id = s.size_id
            LEFT JOIN colors c ON v.color_id = c.color_id
            LEFT JOIN materials m ON v.material_id = m.material_id
            LEFT JOIN inventory i ON v.variant_id = i.variant_id
            WHERE v.product_id = ? AND v.is_active = 1
            GROUP BY v.variant_id
            HAVING inventory_quantity > 0
        `, [productId]);

        const [images] = await pool.query(`
            SELECT image_id, variant_id, image_url, is_primary, sort_order
            FROM product_images WHERE product_id = ?
            ORDER BY is_primary DESC, sort_order ASC
        `, [productId]);

        product.variants = variants;
        product.images = images;
        return product;
    },

    // 3. Tạo sản phẩm mới (Transaction)
    create: async (productData, variantsData, imagesData, accountId, branchId) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const { product_name, description, category_id, brand_id, base_price, is_active = 1, size_guide_image_url } = productData;
            const [productResult] = await connection.query(
                'INSERT INTO products (product_name, description, category_id, brand_id, base_price, is_active, size_guide_image_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [product_name, description, category_id, brand_id || null, base_price, is_active, size_guide_image_url || null]
            );
            const productId = productResult.insertId;

            const targetBranchId = branchId || 1;
            for (const variant of variantsData) {
                // Tạo SKU tự động nếu không truyền
                const sku = variant.sku || `SKU-${productId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                
                const [variantResult] = await connection.query(
                    'INSERT INTO product_variants (product_id, sku, size_id, size_description, color_id, material_id, price) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [productId, sku, variant.size_id || null, variant.size_description || null, variant.color_id || null, variant.material_id || null, variant.price || base_price]
                );
                
                const variantId = variantResult.insertId;
                variant.variant_id = variantId;

                // Lưu ảnh riêng cho biến thể nếu có
                if (variant.image_url && variant.image_url.trim() !== '') {
                    await connection.query(
                        'INSERT INTO product_images (product_id, variant_id, image_url, is_primary) VALUES (?, ?, ?, 0)',
                        [productId, variantId, variant.image_url]
                    );
                }

                // Khởi tạo tồn kho
                const quantity = variant.quantity || 0;
                if (quantity > 0) {
                    await connection.query(
                        'INSERT INTO inventory (variant_id, branch_id, quantity) VALUES (?, ?, ?)',
                        [variantId, targetBranchId, quantity]
                    );
                }
            }

            if (imagesData && imagesData.length > 0) {
                for (let i = 0; i < imagesData.length; i++) {
                    const img = imagesData[i];
                    let targetVariantId = img.variant_id || null;
                    if (!targetVariantId && img.color_id) {
                        const match = variantsData.find(v => String(v.color_id) === String(img.color_id));
                        if (match) targetVariantId = match.variant_id;
                    }
                    await connection.query(
                        'INSERT INTO product_images (product_id, variant_id, image_url, is_primary, sort_order) VALUES (?, ?, ?, ?, ?)',
                        [productId, targetVariantId, img.url, img.is_primary ? 1 : (i === 0 ? 1 : 0), i]
                    );
                }
            }

            await connection.query(
                'INSERT INTO activity_logs (account_id, action, target_table, target_id, description) VALUES (?, ?, ?, ?, ?)',
                [accountId, 'CREATE_PRODUCT', 'products', productId, `Tạo sản phẩm: ${product_name} với ${variantsData.length} biến thể`]
            );

            await connection.commit();
            return productId;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    },

    // 4. Cập nhật sản phẩm (Transaction)
    update: async (productId, productData, variantsData, imagesData, accountId, branchId) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // 4.1 Update thông tin cơ bản
            const { product_name, description, category_id, brand_id, base_price, is_active, size_guide_image_url } = productData;
            await connection.query(
                `UPDATE products SET 
                    product_name = ?, description = ?, category_id = ?,
                    brand_id = ?, base_price = ?, is_active = ?, size_guide_image_url = ?
                 WHERE product_id = ?`,
                [product_name, description, category_id, brand_id || null, base_price, is_active ?? 1, size_guide_image_url || null, productId]
            );

            // 4.2 Xử lý variants: upsert từng variant
            if (variantsData && variantsData.length > 0) {
                const targetBranchId = branchId || 1;
                for (const variant of variantsData) {
                    if (variant.variant_id) {
                        // Variant đã tồn tại → UPDATE
                        await connection.query(
                            `UPDATE product_variants SET sku = ?, size_id = ?, size_description = ?, color_id = ?, material_id = ?, price = ?
                             WHERE variant_id = ? AND product_id = ?`,
                            [variant.sku, variant.size_id || null, variant.size_description || null, variant.color_id || null,
                             variant.material_id || null, variant.price, variant.variant_id, productId]
                        );
                        // Cập nhật tồn kho
                        await connection.query(
                            `INSERT INTO inventory (variant_id, branch_id, quantity) VALUES (?, ?, ?)
                             ON DUPLICATE KEY UPDATE quantity = ?`,
                            [variant.variant_id, targetBranchId, variant.quantity ?? 0, variant.quantity ?? 0]
                        );
                    } else {
                        // Variant mới → INSERT
                        const sku = variant.sku || `SKU-${productId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                        const [vRes] = await connection.query(
                            'INSERT INTO product_variants (product_id, sku, size_id, size_description, color_id, material_id, price) VALUES (?, ?, ?, ?, ?, ?, ?)',
                            [productId, sku, variant.size_id || null, variant.size_description || null, variant.color_id || null, variant.material_id || null, variant.price || base_price]
                        );
                        const newVariantId = vRes.insertId;
                        variant.variant_id = newVariantId;
                        const quantity = variant.quantity || 0;
                        if (quantity > 0) {
                            await connection.query(
                                'INSERT INTO inventory (variant_id, branch_id, quantity) VALUES (?, ?, ?)',
                                [newVariantId, targetBranchId, quantity]
                            );
                        }
                    }
                }
            }

            // 4.3 Xử lý ảnh: thay thế toàn bộ ảnh cũ bằng danh sách mới
            if (imagesData !== undefined) {
                await connection.query('DELETE FROM product_images WHERE product_id = ?', [productId]);
                if (imagesData.length > 0) {
                    for (let i = 0; i < imagesData.length; i++) {
                        const img = imagesData[i];
                        let targetVariantId = img.variant_id || null;
                        if (!targetVariantId && img.color_id) {
                            const match = variantsData.find(v => String(v.color_id) === String(img.color_id));
                            if (match) targetVariantId = match.variant_id;
                        }
                        await connection.query(
                            'INSERT INTO product_images (product_id, variant_id, image_url, is_primary, sort_order) VALUES (?, ?, ?, ?, ?)',
                            [productId, targetVariantId, img.url, img.is_primary ? 1 : (i === 0 ? 1 : 0), i]
                        );
                    }
                }
            }

            // 4.4 Activity log
            await connection.query(
                'INSERT INTO activity_logs (account_id, action, target_table, target_id, description) VALUES (?, ?, ?, ?, ?)',
                [accountId, 'UPDATE_PRODUCT', 'products', productId, `Cập nhật sản phẩm ID=${productId}: ${product_name}`]
            );

            await connection.commit();
            return true;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    },

    // 5. Xóa biến thể (ON DELETE CASCADE sẽ tự xóa inventory + images gắn theo variant)
    deleteVariant: async (variantId, productId) => {
        const [result] = await pool.query(
            'DELETE FROM product_variants WHERE variant_id = ? AND product_id = ?',
            [variantId, productId]
        );
        return result.affectedRows > 0;
    },

    // 6. Xóa hoàn toàn sản phẩm (ON DELETE CASCADE xóa variants, images, inventory)
    delete: async (productId, accountId) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [[p]] = await connection.query(
                'SELECT product_name FROM products WHERE product_id = ?', [productId]
            );
            if (!p) throw { statusCode: 404, message: 'Không tìm thấy sản phẩm' };

            await connection.query('DELETE FROM products WHERE product_id = ?', [productId]);

            await connection.query(
                'INSERT INTO activity_logs (account_id, action, target_table, target_id, description) VALUES (?, ?, ?, ?, ?)',
                [accountId, 'DELETE_PRODUCT', 'products', productId, `Xóa sản phẩm: ${p.product_name}`]
            );

            await connection.commit();
            return true;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    },

    // 7. Bật/Tắt trạng thái sản phẩm
    toggleStatus: async (productId, status) => {
        await pool.query('UPDATE products SET is_active = ? WHERE product_id = ?', [status, productId]);
    }
};

module.exports = ProductModel;
