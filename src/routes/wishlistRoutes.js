const express = require('express');
const router = express.Router();
const wishlistController = require('../controllers/wishlistController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.use(protect);
router.use(authorize('customer'));

router.get('/', wishlistController.get);
router.post('/toggle', wishlistController.toggle);

module.exports = router;
