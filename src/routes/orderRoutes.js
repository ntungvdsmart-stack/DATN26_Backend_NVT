const express = require('express');
const router = express.Router();
const OrderController = require('../controllers/orderController');
const { protect, authorize } = require('../middlewares/authMiddleware');

const staffOrAdmin = authorize('admin', 'staff');

// ── Public / Customer (Tạo đơn hàng online) ───────────────────────────
// Không bắt buộc đăng nhập để mua hàng, nếu có token thì verifyToken có thể next() ngay cả khi lỗi nếu dùng middleware không bắt buộc.
// Nhưng ở đây ta cứ dùng không cần token cho đơn giản, tự extract user nếu có header.
router.post('/', OrderController.createOrder);

// ── Khách hàng lấy đơn của mình ───────────────────────────────────────
// (Cần middleware authenticate để biết user id)
// router.get('/my-orders', authenticate, OrderController.getMyOrders);

// ── Admin / Staff (Quản lý đơn hàng) ─────────────────────────────────
router.get('/admin', protect, staffOrAdmin, OrderController.getAllOrders);
router.patch('/admin/:id/status', protect, staffOrAdmin, OrderController.updateOrderStatus);

module.exports = router;
