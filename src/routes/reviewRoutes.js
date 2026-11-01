const validateDeleteIds = require('../middlewares/validateDeleteIds');
const express = require('express');
const router = express.Router();
const ReviewController = require('../controllers/reviewController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const validateId = (req, res, next, value) => {
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        return res.status(400).json({ success: false, message: 'Mã sản phẩm hoặc đánh giá không hợp lệ' });
    }
    next();
};
router.param('productId', validateId);
router.param('reviewId', validateId);
router.get('/manage', protect, authorize('admin','staff'), require('../controllers/reviewInboxController').list);

// Public: Lấy danh sách đánh giá cho 1 sản phẩm
router.get('/products/:productId', ReviewController.getProductReviews);

// Customer: Kiểm tra quyền đánh giá
router.get('/products/:productId/can-review', protect, authorize('customer'), ReviewController.checkCanReview);

// Customer: Tạo đánh giá mới
router.post('/products/:productId', protect, authorize('customer'), ReviewController.createReview);

router.put('/:reviewId', protect, authorize('customer'), ReviewController.updateReview);
router.delete('/:reviewId', protect, authorize('customer'), validateDeleteIds, ReviewController.deleteReview);

module.exports = router;
