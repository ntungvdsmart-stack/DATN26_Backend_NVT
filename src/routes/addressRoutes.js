const express = require('express');
const router = express.Router();
const addressController = require('../controllers/addressController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.use(protect);
router.use(authorize('customer'));

router.get('/', addressController.get);
router.post('/', addressController.add);
router.delete('/:id', addressController.remove);
router.put('/:id/default', addressController.setDefault);

module.exports = router;
