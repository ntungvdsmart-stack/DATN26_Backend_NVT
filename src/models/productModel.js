const pool = require('../config/database');
const { assertNoHistory, clearShoppingReferences } = require('../services/productDeletionService');

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
    getById: async (productId, branchId = null) => {
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
            LEFT JOIN inventory i ON v.variant_id = i.variant_id AND (? IS NULL OR i.branch_id = ?)
            WHERE v.product_id = ?
            GROUP BY v.variant_id
        `, [branchId, branchId, productId]);

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
                p.product_id, p.product_name, p.base_price, p.created_at, p.category_id, p.brand_id,
                (SELECT variant_id FROM product_variants pv WHERE pv.product_id = p.product_id AND pv.is_active = 1 ORDER BY pv.variant_id LIMIT 1) AS variant_id,
                c.category_name, pc.category_name AS parent_category_name, b.brand_name,
                COALESCE(sales.sold_count, 0) AS sold_count,
                (SELECT image_url FROM product_images pi WHERE pi.product_id = p.product_id AND pi.is_primary = 1 LIMIT 1) as primary_image
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.category_id
            LEFT JOIN categories pc ON pc.category_id = c.parent_id
            LEFT JOIN brands b ON p.brand_id = b.brand_id
            LEFT JOIN (
                SELECT v.product_id, SUM(GREATEST(0, oi.quantity - COALESCE(ret.quantity, 0))) AS sold_count
                FROM order_items oi
                JOIN orders o ON o.order_id = oi.order_id AND o.order_status IN ('completed', 'returned')
                JOIN product_variants v ON v.variant_id = oi.variant_id
                LEFT JOIN (
                    SELECT ri.order_item_id, SUM(ri.quantity) AS quantity
                    FROM order_return_items ri JOIN order_returns r ON r.return_id = ri.return_id
                    WHERE r.status = 'completed' AND r.return_type = 'return'
                    GROUP BY ri.order_item_id
                ) ret ON ret.order_item_id = oi.order_item_id
                GROUP BY v.product_id
            ) sales ON sales.product_id = p.product_id
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

            for (const variant of variantsData) {
                // Tạo SKU tự động nếu không truyền
                const sku = variant.sku || `SKU-${productId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                
                const [variantResult] = await connection.query(
                    'INSERT INTO product_variants (product_id, sku, size_id, size_description, color_id, material_id, price) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [productId, sku, variant.size_id || null, variant.size_description || null, variant.color_id || null, variant.material_id || null, variant.price ?? base_price]
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

                // Nhân viên nhập hàng tại chi nhánh bằng nghiệp vụ nhập kho riêng.
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
            const [[existingProduct]] = await connection.query('SELECT product_id FROM products WHERE product_id = ? FOR UPDATE', [productId]);
            if (!existingProduct) throw Object.assign(new Error('Không tìm thấy sản phẩm'), { statusCode: 404 });
            const [existingVariants] = await connection.query('SELECT variant_id FROM product_variants WHERE product_id = ? ORDER BY variant_id FOR UPDATE', [productId]);
            if (variantsData.some(variant => variant.variant_id && !existingVariants.some(existing => Number(existing.variant_id) === Number(variant.variant_id)))) throw Object.assign(new Error('Biến thể không thuộc sản phẩm đang sửa'), { statusCode: 400 });
            const removedIds = existingVariants.filter(existing => !variantsData.some(variant => Number(variant.variant_id) === Number(existing.variant_id))).map(row => row.variant_id);
            await assertNoHistory(connection, removedIds);
            await clearShoppingReferences(connection, removedIds);
            if (removedIds.length) await connection.query('DELETE FROM product_variants WHERE product_id = ? AND variant_id IN (?)', [productId, removedIds]);

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
                for (const variant of variantsData) {
                    if (variant.variant_id) {
                        // Variant đã tồn tại → UPDATE
                        await connection.query(
                            `UPDATE product_variants SET sku = ?, size_id = ?, size_description = ?, color_id = ?, material_id = ?, price = ?
                             WHERE variant_id = ? AND product_id = ?`,
                            [variant.sku, variant.size_id || null, variant.size_description || null, variant.color_id || null,
                             variant.material_id || null, variant.price, variant.variant_id, productId]
                        );
                    } else {
                        // Variant mới → INSERT
                        const sku = variant.sku || `SKU-${productId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                        const [vRes] = await connection.query(
                            'INSERT INTO product_variants (product_id, sku, size_id, size_description, color_id, material_id, price) VALUES (?, ?, ?, ?, ?, ?, ?)',
                            [productId, sku, variant.size_id || null, variant.size_description || null, variant.color_id || null, variant.material_id || null, variant.price ?? base_price]
                        );
                        const newVariantId = vRes.insertId;
                        variant.variant_id = newVariantId;
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
                        if (removedIds.some(id => Number(id) === Number(targetVariantId))) targetVariantId = null;
                        if (targetVariantId && !variantsData.some(variant => Number(variant.variant_id) === Number(targetVariantId))) throw Object.assign(new Error('Ảnh không thuộc biến thể của sản phẩm đang sửa'), { statusCode: 400 });
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

    // 5. Xóa biến thể: giữ lịch sử giao dịch, dọn tham chiếu mua sắm trong giao dịch.
    deleteVariant: async (variantId, productId, accountId) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query('SELECT product_id FROM products WHERE product_id = ? FOR UPDATE', [productId]);
            const [variants] = await connection.query('SELECT variant_id FROM product_variants WHERE product_id = ? ORDER BY variant_id FOR UPDATE', [productId]);
            if (!variants.some(row => Number(row.variant_id) === Number(variantId))) { await connection.rollback(); return false; }
            if (variants.length <= 1) throw Object.assign(new Error('Không thể xóa biến thể cuối cùng. Hãy ngừng bán hoặc xóa cả sản phẩm nếu chưa phát sinh giao dịch.'), { statusCode: 409 });
            await assertNoHistory(connection, [Number(variantId)]);
            await clearShoppingReferences(connection, [Number(variantId)]);
            await connection.query('DELETE FROM product_variants WHERE variant_id = ? AND product_id = ?', [variantId, productId]);
            if (accountId) await connection.query('INSERT INTO activity_logs (account_id, action, target_table, target_id, description) VALUES (?, ?, ?, ?, ?)', [accountId, 'DELETE_VARIANT', 'products', productId, `Xóa biến thể ${variantId}`]);
            await connection.commit();
            return true;
        } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    },

    // 6. Xóa hoàn toàn sản phẩm (ON DELETE CASCADE xóa variants, images, inventory)
    delete: async (productId, accountId) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [[p]] = await connection.query(
                'SELECT product_name FROM products WHERE product_id = ? FOR UPDATE', [productId]
            );
            if (!p) throw { statusCode: 404, message: 'Không tìm thấy sản phẩm' };
            const [variants] = await connection.query('SELECT variant_id FROM product_variants WHERE product_id = ? ORDER BY variant_id FOR UPDATE', [productId]);
            const variantIds = variants.map(row => row.variant_id);
            await assertNoHistory(connection, variantIds);
            await clearShoppingReferences(connection, variantIds);
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
        const [result] = await pool.query('UPDATE products SET is_active = ? WHERE product_id = ?', [status, productId]);
        return result.affectedRows;
    }
};

module.exports = ProductModel;
