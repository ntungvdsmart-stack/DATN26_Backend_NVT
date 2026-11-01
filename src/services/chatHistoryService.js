const pool = require('../config/database');
async function getChatHistory(id, query = {}) {
    const requested = Number(query.page || 1), limit = Number(query.limit || 50);
    if (!Number.isSafeInteger(requested) || requested < 1 || requested > 1000000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw Object.assign(new Error('Trang tin nhắn không hợp lệ'), { statusCode: 400 });
    const [[count]] = await pool.query('SELECT COUNT(*) AS total FROM chat_messages WHERE conversation_id = ?', [id]);
    const totalPages = Math.max(1, Math.ceil(Number(count.total) / limit));
    const page = Math.min(requested, totalPages);
    const [rows] = await pool.query('SELECT message_id, sender_type, message_content AS content, sent_at AS timestamp, sent_at FROM chat_messages WHERE conversation_id = ? ORDER BY message_id DESC LIMIT ? OFFSET ?', [id, limit, (page - 1) * limit]);
    return { rows: rows.reverse(), pagination: { page, limit, total: Number(count.total), totalPages } };
}
module.exports = { getChatHistory };
