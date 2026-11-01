const express = require('express');
const router = express.Router();
const InventoryController = require('../controllers/inventoryController');
const { protect, authorize } = require('../middlewares/authMiddleware');

const staffOrAdmin = [protect, authorize('admin', 'staff')];

router.get('/', ...staffOrAdmin, InventoryController.getInventory);
router.post('/variants/:variant_id/branches/:branch_id/receive', ...staffOrAdmin, (req, res, next) => { req.inventoryOperation = 'receive'; return InventoryController.updateInventory(req, res, next); });
router.put('/variants/:variant_id/branches/:branch_id', ...staffOrAdmin, InventoryController.updateInventory);
router.put('/:inventory_id', ...staffOrAdmin, InventoryController.updateInventory);

module.exports = router;
