const validateResourceId = require('../middlewares/validateResourceId');
const express = require('express');
const router = express.Router();
router.param('id', validateResourceId);
const BranchController = require('../controllers/branchController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.get('/', protect, authorize('admin', 'staff'), BranchController.getAllBranches);
router.post('/', protect, authorize('admin'), BranchController.createBranch);
router.put('/:id', protect, authorize('admin'), BranchController.updateBranch);
router.patch('/:id/status', protect, authorize('admin'), BranchController.toggleStatus);

module.exports = router;
