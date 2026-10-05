const pool = require('../config/database');
const { sendResponse } = require('../utils/responseHelper');

const ReviewController = {
    // 1. Lấy danh sách đánh giá của 1 sản phẩm (Public)
    getProductReviews: async (req, res, next) => {
        try {
            const productId = req.params.productId;

            // Lấy thống kê tổng quan
            const [stats] = await pool.query(`
                SELECT 
                    COUNT(*) as total_reviews,
                    ROUND(AVG(cr.rating), 1) as avg_rating,
                    SUM(CASE WHEN cr.rating = 5 THEN 1 ELSE 0 END) as star_5,
                    SUM(CASE WHEN cr.rating = 4 THEN 1 ELSE 0 END) as star_4,
                    SUM(CASE WHEN cr.rating = 3 THEN 1 ELSE 0 END) as star_3,
                    SUM(CASE WHEN cr.rating = 2 THEN 1 ELSE 0 END) as star_2,
                    SUM(CASE WHEN cr.rating = 1 THEN 1 ELSE 0 END) as star_1
                FROM customer_reviews cr
                JOIN product_variants v ON cr.variant_id = v.variant_id
                WHERE v.product_id = ?
            `, [productId]);

            // Lấy danh sách reviews kèm thông tin người dùng
            const [reviews] = await pool.query(`
                SELECT 
                    cr.review_id, cr.rating, cr.comment, cr.created_at,
                    c.full_name as customer_name,
                    s.size_value, cl.color_name
                FROM customer_reviews cr
                JOIN customers c ON cr.customer_id = c.customer_id
                JOIN product_variants v ON cr.variant_id = v.variant_id
                LEFT JOIN sizes s ON v.size_id = s.size_id
                LEFT JOIN colors cl ON v.color_id = cl.color_id
                WHERE v.product_id = ?
                ORDER BY cr.created_at DESC
                LIMIT 50
            `, [productId]);

            return sendResponse(res, 200, true, 'OK', {
                stats: stats[0],
                reviews
            });
        } catch (error) {
            next(error);
        }
    },

    // 2. Khách hàng tạo đánh giá mới (cần đăng nhập + đã mua sản phẩm)
    createReview: async (req, res, next) => {
        try {
            const customerId = req.user.id;
            const productId = req.params.productId;
            const { variant_id, rating, comment } = req.body;

            // Validate
            if (!variant_id || !rating) {
                return sendResponse(res, 400, false, 'Vui lòng chọn sản phẩm và đánh giá sao');
            }
            if (rating < 1 || rating > 5) {
                return sendResponse(res, 400, false, 'Đánh giá phải từ 1-5 sao');
            }

            // Kiểm tra variant có thuộc product không
            const [variants] = await pool.query(
                'SELECT variant_id FROM product_variants WHERE variant_id = ? AND product_id = ?',
                [variant_id, productId]
            );
            if (variants.length === 0) {
                return sendResponse(res, 400, false, 'Biến thể không thuộc sản phẩm này');
            }

            // Kiểm tra khách đã mua sản phẩm này chưa (đơn hàng đã completed)
            const [purchased] = await pool.query(`
                SELECT o.order_id FROM orders o
                JOIN order_items oi ON o.order_id = oi.order_id
                WHERE o.customer_id = ? AND oi.variant_id = ? AND o.order_status = 'completed'
                LIMIT 1
            `, [customerId, variant_id]);

            if (purchased.length === 0) {
                return sendResponse(res, 403, false, 'Bạn cần mua sản phẩm này trước khi đánh giá');
            }

            const orderId = purchased[0].order_id;

            // Kiểm tra đã đánh giá variant này chưa
            const [existing] = await pool.query(
                'SELECT review_id FROM customer_reviews WHERE customer_id = ? AND variant_id = ?',
                [customerId, variant_id]
            );
            if (existing.length > 0) {
                return sendResponse(res, 400, false, 'Bạn đã đánh giá sản phẩm này rồi');
            }

            // Tạo review
            const [result] = await pool.query(
                'INSERT INTO customer_reviews (customer_id, variant_id, order_id, rating, comment) VALUES (?, ?, ?, ?, ?)',
                [customerId, variant_id, orderId, rating, comment || null]
            );

            return sendResponse(res, 201, true, 'Đánh giá thành công! Cảm ơn bạn.', {
                review_id: result.insertId
            });
        } catch (error) {
            next(error);
        }
    },

    // 3. Kiểm tra khách hàng có quyền đánh giá sản phẩm này không
    checkCanReview: async (req, res, next) => {
        try {
            const customerId = req.user.id;
            const productId = req.params.productId;

            // Lấy tất cả variant đã mua (completed) mà chưa review
            const [purchasedVariants] = await pool.query(`
                SELECT DISTINCT oi.variant_id, s.size_value, cl.color_name
                FROM orders o
                JOIN order_items oi ON o.order_id = oi.order_id
                JOIN product_variants v ON oi.variant_id = v.variant_id
                LEFT JOIN sizes s ON v.size_id = s.size_id
                LEFT JOIN colors cl ON v.color_id = cl.color_id
                WHERE o.customer_id = ? 
                  AND v.product_id = ? 
                  AND o.order_status = 'completed'
                  AND oi.variant_id NOT IN (
                      SELECT cr.variant_id FROM customer_reviews cr WHERE cr.customer_id = ?
                  )
            `, [customerId, productId, customerId]);

            return sendResponse(res, 200, true, 'OK', {
                canReview: purchasedVariants.length > 0,
                reviewableVariants: purchasedVariants
            });
        } catch (error) {
            next(error);
        }
    }
};

module.exports = ReviewController;
