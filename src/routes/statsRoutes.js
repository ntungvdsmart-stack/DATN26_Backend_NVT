const express = require('express');
const router = express.Router();
const StatsController = require('../controllers/statsController');
const { protect, authorize } = require('../middlewares/authMiddleware');

const staffOrAdmin = [protect, authorize('admin', 'staff')];

router.get('/kpi', ...staffOrAdmin, StatsController.getKPIs);
router.get('/revenue', ...staffOrAdmin, StatsController.getRevenueChart);
router.get('/top-products', ...staffOrAdmin, StatsController.getTopProducts);
router.get('/top-products', ...staffOrAdmin, StatsController.getTopProducts);
router.get('/category', ...staffOrAdmin, StatsController.getCategoryStats);
router.get('/payments', ...staffOrAdmin, StatsController.getPaymentStats);
router.get('/channel', ...staffOrAdmin, StatsController.getChannelStats);
router.get('/staff-daily', ...staffOrAdmin, StatsController.getStaffDailyStats);

module.exports = router;
