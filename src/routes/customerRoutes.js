const express = require('express');
const router = express.Router();
const CustomerController = require('../controllers/customerController');
const { protect, authorize } = require('../middlewares/authMiddleware');

const staffOrAdmin = authorize('admin', 'staff');

// ── KHÁCH HÀNG TỰ PHỤC VỤ (Customer Self-Service) ────────────────────
// Đặt TRƯỚC các route có :id để tránh conflict
router.get('/me', protect, authorize('customer'), CustomerController.getMyProfile);
router.put('/me', protect, authorize('customer'), CustomerController.updateMyProfile);
router.put('/me/password', protect, authorize('customer'), CustomerController.changeMyPassword);
router.get('/me/orders', protect, authorize('customer'), CustomerController.getMyOrders);
router.get('/me/orders/:id', protect, authorize('customer'), CustomerController.getMyOrderDetail);

// === QUẢN LÝ KHÁCH HÀNG (Admin/Staff) ===
router.get('/', protect, staffOrAdmin, CustomerController.getAllCustomers);
router.get('/:id', protect, staffOrAdmin, CustomerController.getCustomerDetails);
router.post('/', protect, staffOrAdmin, CustomerController.createCustomerAdmin);
router.patch('/:id/status', protect, staffOrAdmin, CustomerController.updateCustomerStatus);

module.exports = router;
