const pool = require('../config/database');
const { getIO, ROOMS } = require('../config/socket');

/**
 * Bảng `notifications` có trigger XOR: mỗi bản ghi phải có ĐÚNG 1 người nhận
 * (customer_id HOẶC account_id). Vì vậy thông báo cho nhân viên phải được
 * "fan-out" thành 1 bản ghi / 1 tài khoản đang hoạt động.
 */
const NotificationService = {
    notifyStaff: async ({ content, orderId = null, type = 'NEW_ORDER', targetUrl = null }, conn = pool) => {
        try {
            const [accounts] = await conn.query('SELECT account_id FROM accounts WHERE is_active = 1 AND (role_id = 1 OR account_id = (SELECT staff_id FROM orders WHERE order_id = ?))', [orderId]);
            for (const acc of accounts) {
                const [result] = await conn.query(
                    'INSERT INTO notifications (account_id, notif_type, content, related_order_id, target_url, is_read) VALUES (?, ?, ?, ?, ?, 0)',
                    [acc.account_id, type, content, orderId, targetUrl]
                );
                getIO()?.to(ROOMS.account(acc.account_id)).emit('new_notification', { notification_id: result.insertId, notif_type: type, content, related_order_id: orderId, target_url: targetUrl, created_at: new Date(), is_read: 0 });
            }
            const io = getIO();
            if (io) {
                io.to(ROOMS.STAFF).emit('orders_changed', { order_id: orderId, type });
            }
        } catch (err) {
            console.error('[NotificationService.notifyStaff]', err.message);
        }
    },

    notifyCustomer: async ({ customerId, content, orderId = null, type = 'order_status' }, conn = pool) => {
        if (!customerId) return;
        try {
            const [result] = await conn.query(
                'INSERT INTO notifications (customer_id, notif_type, content, related_order_id, is_read) VALUES (?, ?, ?, ?, 0)',
                [customerId, type, content, orderId]
            );
            const io = getIO();
            if (io) {
                io.to(ROOMS.customer(customerId)).emit('new_notification', {
                    notification_id: result.insertId,
                    notif_type: type, content, related_order_id: orderId, created_at: new Date(), is_read: 0
                });
            }
        } catch (err) {
            console.error('[NotificationService.notifyCustomer]', err.message);
        }
    },

    notifySingleStaff: async ({ accountId, content, orderId = null, type = 'ORDER_ASSIGNED', targetUrl = null, messageId = null }, conn = pool) => {
        if (!accountId) return;
        try {
            let orderCode = null;
            if (orderId) {
                const [[order]] = await conn.query('SELECT order_code FROM orders WHERE order_id = ?', [orderId]);
                orderCode = order?.order_code || null;
            }
            const [result] = await conn.query(
                'INSERT INTO notifications (account_id, notif_type, content, related_order_id, target_url, related_message_id, is_read) VALUES (?, ?, ?, ?, ?, ?, 0)',
                [accountId, type, content, orderId, targetUrl, messageId]
            );
            const io = getIO();
            if (io) {
                const notifData = {
                    notification_id: result.insertId,
                    notif_type: type,
                    content,
                    related_order_id: orderId,
                    target_url: targetUrl,
                    order_code: orderCode,
                    created_at: new Date(),
                    is_read: 0
                };
                // User's private room is their ID in NotificationBell
                io.to(ROOMS.account(accountId)).emit('new_notification', notifData);
                if (orderId) io.to(ROOMS.account(accountId)).emit('orders_changed', { order_id: orderId, type });
            }
        } catch (err) {
            console.error('[NotificationService.notifySingleStaff]', err.message);
        }
    }
};

module.exports = NotificationService;
