const pool = require('../config/database');
exports.history = async (customerId, query = {}) => {
    const requested = Number(query.page || 1), limit = Number(query.limit || 50);
    if (!Number.isSafeInteger(requested) || requested < 1 || requested > 1000000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw Object.assign(new Error('Trang lịch sử không hợp lệ'), { statusCode: 400 });
    const [[count]] = await pool.query('SELECT COUNT(*) AS total FROM ai_chat_messages WHERE customer_id = ?', [customerId]);
    const totalPages = Math.max(1, Math.ceil(Number(count.total) / limit)), page = Math.min(requested, totalPages);
    const [rows] = await pool.query('SELECT message_id, sender_type, message_content AS content, sent_at FROM ai_chat_messages WHERE customer_id = ? ORDER BY message_id DESC LIMIT ? OFFSET ?', [customerId, limit, (page - 1) * limit]);
    return { rows: rows.reverse(), pagination: { page, limit, total: Number(count.total), totalPages } };
};
exports.saveExchange = async (customerId, question, answer) => {
    // A single statement saves the pair atomically, without partial conversations.
    await pool.query("INSERT INTO ai_chat_messages (customer_id, sender_type, message_content) VALUES (?, 'customer', ?), (?, 'bot', ?)", [customerId, question, customerId, answer]);
};
