const express = require('express');
const router = express.Router();
const ReviewController = require('../controllers/reviewController');
const { protect, authorize } = require('../middlewares/authMiddleware');

// Public: Lấy danh sách đánh giá cho 1 sản phẩm
router.get('/products/:productId', ReviewController.getProductReviews);

// Customer: Kiểm tra quyền đánh giá
router.get('/products/:productId/can-review', protect, authorize('customer'), ReviewController.checkCanReview);

// Customer: Tạo đánh giá mới
router.post('/products/:productId', protect, authorize('customer'), ReviewController.createReview);

module.exports = router;
