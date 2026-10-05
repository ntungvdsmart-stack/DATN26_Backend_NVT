const express = require('express');
const router = express.Router();
const SupportController = require('../controllers/supportController');
const { protect, authorize } = require('../middlewares/authMiddleware');

const staffOrAdmin = [protect, authorize('admin', 'staff')];

// Public route for Chatbot
router.post('/gemini-chat', SupportController.chatWithGemini);

router.get('/sessions', ...staffOrAdmin, SupportController.getSessions);
router.get('/sessions/:id/messages', ...staffOrAdmin, SupportController.getMessages);
router.post('/sessions/:id/messages', ...staffOrAdmin, SupportController.sendMessage);
router.patch('/sessions/:id/status', ...staffOrAdmin, SupportController.updateSessionStatus);
router.get('/sessions/:id/branch-suggestions', ...staffOrAdmin, SupportController.getBranchSuggestions);
router.post('/sessions/:id/assign', ...staffOrAdmin, SupportController.assignSession);

module.exports = router;
