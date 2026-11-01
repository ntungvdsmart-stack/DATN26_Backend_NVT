const pool = require('../config/database');
const { getIO, ROOMS } = require('../config/socket');
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
async function notifyChat(conversationId, staffIds = [], notification = null) {
    try {
        const [admins] = await pool.query('SELECT account_id FROM accounts WHERE role_id = 1 AND is_active = 1');
        const [[session]] = await pool.query('SELECT staff_id FROM chat_conversations WHERE conversation_id = ?', [conversationId]);
        const recipients = notification ? [session?.staff_id] : staffIds;
        for (const id of new Set([...admins.map(row => row.account_id), ...recipients.filter(Boolean)])) {
            getIO()?.to(ROOMS.account(id)).emit('chat_message', { conversation_id: conversationId });
            if (notification) await require('./notificationService').notifySingleStaff({ accountId: id, ...notification, targetUrl: `/support?conversation=${conversationId}` });
        }
    } catch { console.error('[chat] Could not emit conversation update'); }
}
async function assignConversation(id, branchId, staffId, adminId) {
    if (![id, branchId, staffId].every(value => /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value)))) throw fail(400, 'Chọn chi nhánh và nhân viên hợp lệ');
    const connection = await pool.getConnection();
    let previous;
    try {
        await connection.beginTransaction();
        const [[session]] = await connection.query('SELECT staff_id, ended_at FROM chat_conversations WHERE conversation_id = ? FOR UPDATE', [id]);
        if (!session) throw fail(404, 'Không tìm thấy hội thoại');
        if (session.staff_id) throw fail(409, 'Hội thoại đã được phân công, không thể phân công lại');
        if (session.ended_at) throw fail(409, 'Hội thoại đã kết thúc');
        previous = session.staff_id;
        const [[staff]] = await connection.query(`SELECT a.account_id FROM accounts a JOIN branches b ON b.branch_id = a.branch_id AND b.is_active = 1
            WHERE a.account_id = ? AND a.branch_id = ? AND a.role_id = 2 AND a.is_active = 1
            AND EXISTS(SELECT 1 FROM role_permissions rp JOIN permissions p ON p.permission_id = rp.permission_id WHERE rp.role_id = a.role_id AND p.permission_code = 'support.manage') FOR UPDATE`, [staffId, branchId]);
        if (!staff) throw fail(400, 'Nhân viên không thuộc chi nhánh, không hoạt động hoặc không có quyền hỗ trợ');
        await connection.query("UPDATE chat_conversations SET staff_id = ?, conversation_type = 'human' WHERE conversation_id = ?", [staffId, id]);
        await connection.query('INSERT INTO activity_logs (account_id, action, target_table, target_id, description) VALUES (?, ?, ?, ?, ?)', [adminId, 'ASSIGN_CHAT', 'chat_conversations', id, `Phân hội thoại cho nhân viên #${staffId}, chi nhánh #${branchId}`]);
        await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    await notifyChat(id, [previous, staffId]);
    await require('./notificationService').notifySingleStaff({ accountId: staffId, type: 'CHAT_ASSIGNED', content: 'B\u1ea1n \u0111\u01b0\u1ee3c ph\u00e2n c\u00f4ng h\u1ed9i tho\u1ea1i kh\u00e1ch h\u00e0ng m\u1edbi.', targetUrl: `/support?conversation=${id}` });
}
async function replyToConversation(id, user, content) {
    const connection = await pool.getConnection();
    let session;
    try {
        await connection.beginTransaction();
        [[session]] = await connection.query('SELECT customer_id, staff_id, ended_at FROM chat_conversations WHERE conversation_id = ? FOR UPDATE', [id]);
        if (!session) throw fail(404, 'Không tìm thấy hội thoại');
        if (user.role !== 'admin' && Number(session.staff_id) !== Number(user.id)) throw fail(403, 'Hội thoại đã chuyển cho nhân viên khác. Vui lòng tải lại danh sách');
        if (session.ended_at) throw fail(409, 'Hội thoại đã kết thúc');
        await connection.query("INSERT INTO chat_messages (conversation_id, sender_type, sender_id, message_content) VALUES (?, 'staff', ?, ?)", [id, user.id, content.trim()]);
        await connection.commit();
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    getIO()?.to(ROOMS.customer(session.customer_id)).emit('chat_message', { conversation_id: id });
    await notifyChat(id, [session.staff_id]);
}
module.exports = { notifyChat, assignConversation, replyToConversation };
