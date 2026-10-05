const express = require('express');
const router = express.Router();
const OrderController = require('../controllers/orderController');
const { protect, authorize, optionalProtect } = require('../middlewares/authMiddleware');

const staffOrAdmin = authorize('admin', 'staff');

// ── Public / Customer (Tạo đơn hàng online) ───────────────────────────
// Bắt buộc đăng nhập để mua hàng online
router.post('/', protect, OrderController.createOrder);
router.get('/tracking/:orderCode', OrderController.trackOrder);
router.post('/customer/:orderCode/cancel', optionalProtect, OrderController.cancelOrderCustomer);

// ── Khách hàng lấy đơn của mình ───────────────────────────────────────
// (Cần middleware authenticate để biết user id)
// router.get('/my-orders', authenticate, OrderController.getMyOrders);

// ── Admin / Staff (Quản lý đơn hàng) ─────────────────────────────────
router.get('/admin', protect, staffOrAdmin, OrderController.getAllOrders);
router.get('/admin/:id', protect, staffOrAdmin, OrderController.getOrderDetails);
router.patch('/admin/:id/status', protect, staffOrAdmin, OrderController.updateOrderStatus);

router.get('/admin/:id/branch-suggestions', protect, authorize('admin'), OrderController.getBranchSuggestions);
router.post('/admin/:id/assign', protect, authorize('admin'), OrderController.assignOrder);
router.delete('/admin/:id', protect, authorize('admin'), OrderController.deleteOrder);

// === BÁN HÀNG TẠI QUẦY (POS) ===
// Chỉ Admin và Staff mới được truy cập POS API
router.post('/pos', protect, staffOrAdmin, OrderController.createPOSOrder);

module.exports = router;
