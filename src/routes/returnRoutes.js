const express = require('express');
const router = express.Router();
const returnController = require('../controllers/returnController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.use(protect);

// Customer creates request
router.post('/request', returnController.createRequest);

// Admin routes
router.get('/', authorize('admin', 'staff'), returnController.getAll);
router.put('/:id/status', authorize('admin', 'staff'), returnController.updateStatus);

module.exports = router;
