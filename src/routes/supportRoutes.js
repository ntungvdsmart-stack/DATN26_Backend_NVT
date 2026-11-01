const express = require('express');
const router = express.Router();
const SupportController = require('../controllers/supportController');
const rateLimit = require('express-rate-limit');
const { protect, optionalProtect, authorize } = require('../middlewares/authMiddleware');

const staffOrAdmin = [protect, authorize('admin', 'staff')];
router.param('id', require('../middlewares/validateResourceId'));

// Public route for Chatbot
router.post('/gemini-chat', rateLimit({ windowMs: 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { success: false, message: 'Bạn gửi quá nhiều câu hỏi. Vui lòng thử lại sau một phút.' } }), optionalProtect, SupportController.chatWithGemini);
router.get('/gemini-history', protect, authorize('customer'), async (req, res, next) => {
    try {
        const history = await require('../services/aiChatHistoryService').history(req.user.id, req.query);
        res.json({ success: true, data: history.rows, pagination: history.pagination });
    } catch (error) { next(error); }
});

router.get('/sessions', ...staffOrAdmin, SupportController.getSessions);
router.get('/unread', ...staffOrAdmin, require('../controllers/chatReadController').unread);
const sessionAccess = async (req, res, next) => {
    try {
        const pool = require('../config/database');
        const [[session]] = await pool.query('SELECT staff_id FROM chat_conversations WHERE conversation_id = ?', [req.params.id]);
        if (!session) return res.status(404).json({ success: false, message: 'Không tìm thấy cuộc hội thoại' });
        if (req.user.role !== 'admin' && Number(session.staff_id) !== Number(req.user.id)) return res.status(403).json({ success: false, message: 'Cuộc hội thoại chưa được phân công cho bạn' });
        next();
    } catch (error) { next(error); }
};
router.get('/sessions/:id/messages', ...staffOrAdmin, sessionAccess, SupportController.getMessages);
router.post('/sessions/:id/read', ...staffOrAdmin, sessionAccess, require('../controllers/chatReadController').markRead);
router.post('/sessions/:id/messages', ...staffOrAdmin, sessionAccess, SupportController.sendMessage);
router.patch('/sessions/:id/status', ...staffOrAdmin, sessionAccess, SupportController.updateSessionStatus);
router.get('/sessions/:id/branch-suggestions', protect, authorize('admin'), sessionAccess, SupportController.getBranchSuggestions);
router.post('/sessions/:id/assign', protect, authorize('admin'), sessionAccess, SupportController.assignSession);

module.exports = router;
