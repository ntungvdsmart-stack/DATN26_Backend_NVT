const pool = require('../config/database');
const { sendResponse } = require('../utils/responseHelper');
const validRating = value => (typeof value === 'number' || typeof value === 'string') && /^[1-5]$/.test(String(value));
const validComment = value => value == null || (typeof value === 'string' && value.length <= 2000);

const ReviewController = {
    // 1. Lấy danh sách đánh giá của 1 sản phẩm (Public)
    getProductReviews: async (req, res, next) => {
        try {
            const productId = req.params.productId;
            const page = Number(req.query.page || 1);
            if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) return sendResponse(res, 400, false, 'Trang không hợp lệ');

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

            const totalPages = Math.max(1, Math.ceil(Number(stats[0].total_reviews) / 10));
            const currentPage = Math.min(page, totalPages);

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
                ORDER BY cr.created_at DESC, cr.review_id DESC
                LIMIT 10 OFFSET ?
            `, [productId, (currentPage - 1) * 10]);

            return sendResponse(res, 200, true, 'OK', {
                stats: stats[0],
                pagination: { page: currentPage, totalPages, totalItems: Number(stats[0].total_reviews) },
                reviews
            });
        } catch (error) {
            next(error);
        }
    },

    // 2. Khách hàng tạo đánh giá mới (cần đăng nhập + đã mua sản phẩm)
    createReview: async (req, res, next) => {
        let connection;
        let committed = false;
        try {
            connection = await pool.getConnection();
            await connection.beginTransaction();
            await connection.query('SELECT customer_id FROM customers WHERE customer_id = ? FOR UPDATE', [req.user.id]);
            const customerId = req.user.id;
            const productId = req.params.productId;
            const { variant_id, rating, comment } = req.body;

            // Validate
            if (!variant_id || !rating) {
                return sendResponse(res, 400, false, 'Vui lòng chọn sản phẩm và đánh giá sao');
            }
            if (!validRating(rating) || !validComment(comment) || !['number', 'string'].includes(typeof variant_id) || !/^[1-9]\d*$/.test(String(variant_id)) || !Number.isSafeInteger(Number(variant_id))) {
                return sendResponse(res, 400, false, 'Chọn phiên bản hợp lệ, từ 1-5 sao và nhận xét tối đa 2000 ký tự');
            }

            // Kiểm tra variant có thuộc product không
            const [variants] = await connection.query(
                'SELECT variant_id FROM product_variants WHERE variant_id = ? AND product_id = ?',
                [variant_id, productId]
            );
            if (variants.length === 0) {
                return sendResponse(res, 400, false, 'Biến thể không thuộc sản phẩm này');
            }

            // Kiểm tra khách đã mua sản phẩm này chưa (đơn hàng đã completed)
            const [purchased] = await connection.query(`
                SELECT o.order_id FROM orders o
                JOIN order_items oi ON o.order_id = oi.order_id
                WHERE o.customer_id = ? AND oi.variant_id = ? AND o.order_status = 'completed'
                ORDER BY o.order_id DESC LIMIT 1
            `, [customerId, variant_id]);

            if (purchased.length === 0) {
                return sendResponse(res, 403, false, 'Bạn cần mua sản phẩm này trước khi đánh giá');
            }

            const orderId = purchased[0].order_id;

            // Kiểm tra đã đánh giá variant này chưa
            const [existing] = await connection.query(
                'SELECT review_id FROM customer_reviews WHERE customer_id = ? AND variant_id = ?',
                [customerId, variant_id]
            );
            if (existing.length > 0) {
                return sendResponse(res, 400, false, 'Bạn đã đánh giá sản phẩm này rồi');
            }

            // Tạo review
            const [result] = await connection.query(
                'INSERT INTO customer_reviews (customer_id, variant_id, order_id, rating, comment) VALUES (?, ?, ?, ?, ?)',
                [customerId, variant_id, orderId, rating, comment?.trim() || null]
            );
            await connection.commit();
            committed = true;
            void require('../services/notificationService').notifyStaff({ orderId, type: 'NEW_REVIEW', content: `Kh\u00e1ch h\u00e0ng v\u1eeba \u0111\u00e1nh gi\u00e1 ${Number(rating)}/5 sao cho s\u1ea3n ph\u1ea9m.`, targetUrl: `/reviews?review=${result.insertId}` });
            return sendResponse(res, 201, true, 'Đánh giá thành công! Cảm ơn bạn.', {
                review_id: result.insertId
            });
        } catch (error) {
            next(error);
        } finally {
            if (connection) {
                if (!committed) await connection.rollback();
                connection.release();
            }
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

            const [ownReviews] = await pool.query(`
                SELECT cr.review_id, cr.variant_id, cr.rating, cr.comment, cr.created_at,
                       s.size_value, cl.color_name
                FROM customer_reviews cr
                JOIN product_variants v ON v.variant_id = cr.variant_id
                LEFT JOIN sizes s ON s.size_id = v.size_id
                LEFT JOIN colors cl ON cl.color_id = v.color_id
                WHERE cr.customer_id = ? AND v.product_id = ?
                ORDER BY cr.created_at DESC, cr.review_id DESC
            `, [customerId, productId]);
            return sendResponse(res, 200, true, 'OK', {
                canReview: purchasedVariants.length > 0,
                reviewableVariants: purchasedVariants,
                ownReviews
            });
        } catch (error) {
            next(error);
        }
    },

    updateReview: async (req, res, next) => {
        try {
            const { rating, comment } = req.body;
            if (!validRating(rating) || !validComment(comment)) {
                return sendResponse(res, 400, false, 'Đánh giá từ 1-5 sao, nhận xét tối đa 2000 ký tự');
            }
            const [result] = await pool.query(
                'UPDATE customer_reviews SET rating = ?, comment = ? WHERE review_id = ? AND customer_id = ?',
                [Number(rating), comment?.trim() || null, req.params.reviewId, req.user.id]
            );
            if (!result.affectedRows) return sendResponse(res, 404, false, 'Không tìm thấy đánh giá của bạn');
            return sendResponse(res, 200, true, 'Đã cập nhật đánh giá');
        } catch (error) { next(error); }
    },

    deleteReview: async (req, res, next) => {
        try {
            const [result] = await pool.query(
                'DELETE FROM customer_reviews WHERE review_id = ? AND customer_id = ?',
                [req.params.reviewId, req.user.id]
            );
            if (!result.affectedRows) return sendResponse(res, 404, false, 'Không tìm thấy đánh giá của bạn');
            return sendResponse(res, 200, true, 'Đã xóa đánh giá');
        } catch (error) { next(error); }
    }
};

module.exports = ReviewController;
