const express = require('express');
const router = express.Router();
const ConfigController = require('../controllers/configController');
const { protect, authorize } = require('../middlewares/authMiddleware');

// GET (Public) - Lấy cấu hình hệ thống
router.get('/', ConfigController.getSettings);

// PUT (Admin) - Chỉ có admin mới được quyền cập nhật
router.put('/', protect, authorize('admin'), ConfigController.updateSettings);

module.exports = router;
