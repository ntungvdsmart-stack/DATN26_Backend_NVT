const router = require('express').Router();
const pool = require('../config/database');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { getIO, ROOMS } = require('../config/socket');
router.use(protect, authorize('customer'));
router.post('/', async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query('SELECT customer_id FROM customers WHERE customer_id = ? FOR UPDATE', [req.user.id]);
        let [[session]] = await connection.query("SELECT conversation_id FROM chat_conversations WHERE customer_id = ? AND conversation_type = 'human' AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1", [req.user.id]);
        if (!session) {
            const [result] = await connection.query("INSERT INTO chat_conversations (customer_id, staff_id, conversation_type) VALUES (?, NULL, 'human')", [req.user.id]);
            session = { conversation_id: result.insertId };
        }
        await connection.commit();
        void require('../services/chatAssignmentService').notifyChat(session.conversation_id);
        res.json({ success: true, data: session });
    } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});
const ownSession = async (req, res, next) => {
    try {
        const [[session]] = await pool.query('SELECT conversation_id, staff_id, ended_at FROM chat_conversations WHERE conversation_id = ? AND customer_id = ?', [req.params.id, req.user.id]);
        if (!session) return res.status(404).json({ success: false, message: 'Không tìm thấy cuộc hội thoại' });
        req.chatSession = session;
        next();
    } catch (error) { next(error); }
};
router.get('/:id/messages', ownSession, async (req, res, next) => {
    try {
        const history = await require('../services/chatHistoryService').getChatHistory(req.params.id, req.query);
        res.json({ success: true, data: history.rows, pagination: history.pagination });
    } catch (error) { next(error); }
});
router.post('/:id/messages', ownSession, async (req, res, next) => {
    try {
        const content = req.body.content;
        if (req.chatSession.ended_at) return res.status(409).json({ success: false, message: 'Hội thoại đã kết thúc. Vui lòng mở hội thoại mới' });
        if (typeof content !== 'string' || !content.trim() || content.length > 4000) return res.status(400).json({ success: false, message: 'Tin nhắn cần có nội dung, tối đa 4000 ký tự' });
        const [result] = await pool.query("INSERT INTO chat_messages (conversation_id, sender_type, sender_id, message_content) VALUES (?, 'customer', ?, ?)", [req.params.id, req.user.id, content.trim()]);
        void require('../services/chatAssignmentService').notifyChat(req.params.id, [req.chatSession.staff_id], { type: 'CHAT_MESSAGE', messageId: result.insertId, content: 'Kh\u00e1ch h\u00e0ng v\u1eeba g\u1eedi tin nh\u1eafn trong h\u1ed9i tho\u1ea1i \u0111\u01b0\u1ee3c giao.' });
        res.status(201).json({ success: true, data: { message_id: result.insertId } });
    } catch (error) { next(error); }
});
module.exports = router;
