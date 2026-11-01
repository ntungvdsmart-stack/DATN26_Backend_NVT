const validateDeleteIds = require('../middlewares/validateDeleteIds');
const express = require('express');
const router = express.Router();
const OrderController = require('../controllers/orderController');
const { protect, authorize, optionalProtect } = require('../middlewares/authMiddleware');

const staffOrAdmin = authorize('admin', 'staff');
router.post('/quote', protect, authorize('admin','staff','customer'), async (req, res, next) => {
    try {
        const channel = req.body.channel || 'online';
        if (channel === 'pos' && (req.user.role === 'customer' || (req.user.role === 'staff' && !req.user.permissions.includes('pos.sell')))) return res.status(403).json({ success: false, message: 'Không có quyền bán tại quầy' });
        const data = await require('../services/orderService').quote({ items: req.body.items, channel, customerId: req.user.role === 'customer' ? req.user.id : req.body.customer_id, promoCode: req.body.promo_code, promotionId: req.body.promotion_id });
        res.json({ success: true, data });
    } catch (error) { next(error); }
});

// ── Public / Customer (Tạo đơn hàng online) ───────────────────────────
// Bắt buộc đăng nhập để mua hàng online
router.post('/', protect, authorize('customer'), OrderController.createOrder);
router.get('/tracking/:orderCode', protect, OrderController.trackOrder);
router.post('/customer/:orderCode/cancel', optionalProtect, OrderController.cancelOrderCustomer);

// ── Khách hàng lấy đơn của mình ───────────────────────────────────────
// (Cần middleware authenticate để biết user id)
// router.get('/my-orders', authenticate, OrderController.getMyOrders);

// ── Admin / Staff (Quản lý đơn hàng) ─────────────────────────────────
router.get('/admin', protect, staffOrAdmin, OrderController.getAllOrders);
router.get('/admin/:id', protect, staffOrAdmin, OrderController.getOrderDetails);
router.patch('/admin/:id/status', protect, staffOrAdmin, OrderController.updateOrderStatus);
router.post('/admin/:id/pickup', protect, authorize('staff'), OrderController.completePickup);

router.get('/admin/:id/branch-suggestions', protect, authorize('admin'), OrderController.getBranchSuggestions);
router.post('/admin/:id/assign', protect, authorize('admin'), OrderController.assignOrder);
router.delete('/admin/:id', protect, authorize('admin'), validateDeleteIds, OrderController.deleteOrder);

// === BÁN HÀNG TẠI QUẦY (POS) ===
// Chỉ Admin và Staff mới được truy cập POS API
router.post('/pos', protect, authorize('staff'), OrderController.createPOSOrder);

module.exports = router;
