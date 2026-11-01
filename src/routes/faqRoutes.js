const validateDeleteIds = require('../middlewares/validateDeleteIds');
const express = require('express');
const router = express.Router();
const faqController = require('../controllers/faqController');
const { protect, authorize } = require('../middlewares/authMiddleware');

// Public route
router.get('/active', faqController.getActive);

// Admin routes
router.use(protect);
router.use(authorize('admin'));

router.get('/', faqController.getAll);
router.post('/', faqController.create);
router.put('/:id', faqController.update);
router.delete('/:id', validateDeleteIds, faqController.remove);

module.exports = router;
