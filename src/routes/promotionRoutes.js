const validateDeleteIds = require('../middlewares/validateDeleteIds');
const express = require('express');
const router = express.Router();
const promotionController = require('../controllers/promotionController');
const { protect, authorize, optionalProtect } = require('../middlewares/authMiddleware');

// Public route to apply promotion (can also pass optional token for customer limits)
// Using an optional auth middleware if needed, but for now we'll decode it inside if present
router.post('/apply', optionalProtect, promotionController.apply);

// Admin routes
router.use(protect);
router.use(authorize('admin', 'staff'));

router.get('/', promotionController.getAll);
router.post('/', promotionController.create);
router.put('/:id', promotionController.update);
router.delete('/:id', validateDeleteIds, promotionController.delete);

module.exports = router;
