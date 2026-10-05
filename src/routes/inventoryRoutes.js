const express = require('express');
const router = express.Router();
const InventoryController = require('../controllers/inventoryController');
const { protect, authorize } = require('../middlewares/authMiddleware');

const staffOrAdmin = [protect, authorize('admin', 'staff')];

router.get('/', ...staffOrAdmin, InventoryController.getInventory);
router.put('/:inventory_id', ...staffOrAdmin, InventoryController.updateInventory);

module.exports = router;
