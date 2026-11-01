const validateDeleteIds = require('../middlewares/validateDeleteIds');
const express = require('express');
const router = express.Router();
const addressController = require('../controllers/addressController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.use(protect);
router.use(authorize('customer'));

router.get('/', addressController.get);
router.post('/', addressController.add);
router.delete('/:id', validateDeleteIds, addressController.remove);
router.put('/:id/default', addressController.setDefault);
router.put('/:id', addressController.add);

module.exports = router;
