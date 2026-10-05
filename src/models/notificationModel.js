const db = require('../config/database');

const notificationModel = {
  // Create a new notification
  createNotification: async (data) => {
    const { customer_id, account_id, notif_type, content, related_order_id } = data;
    const [result] = await db.query(
      `INSERT INTO notifications (customer_id, account_id, notif_type, content, related_order_id, is_read) 
       VALUES (?, ?, ?, ?, ?, 0)`,
      [customer_id || null, account_id || null, notif_type, content, related_order_id || null]
    );
    return result.insertId;
  },

  // Get notifications for a user (Customer or Staff/Admin)
  getUserNotifications: async (userId, role) => {
    let query = '';
    let params = [];

    if (role === 'customer') {
      query = 'SELECT * FROM notifications WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50';
      params = [userId];
    } else {
      // For admin/staff, we get notifications targeted to their account, or generic system notifications (where account_id IS NULL and customer_id IS NULL)
      query = 'SELECT * FROM notifications WHERE account_id = ? OR (account_id IS NULL AND customer_id IS NULL) ORDER BY created_at DESC LIMIT 50';
      params = [userId];
    }

    const [rows] = await db.query(query, params);
    return rows;
  },

  // Mark a single notification as read
  markAsRead: async (notificationId) => {
    const [result] = await db.query(
      'UPDATE notifications SET is_read = 1 WHERE notification_id = ?',
      [notificationId]
    );
    return result.affectedRows;
  },

  // Mark all notifications as read for a specific user
  markAllAsRead: async (userId, role) => {
    let query = '';
    let params = [];

    if (role === 'customer') {
      query = 'UPDATE notifications SET is_read = 1 WHERE customer_id = ? AND is_read = 0';
      params = [userId];
    } else {
      query = 'UPDATE notifications SET is_read = 1 WHERE (account_id = ? OR (account_id IS NULL AND customer_id IS NULL)) AND is_read = 0';
      params = [userId];
    }

    const [result] = await db.query(query, params);
    return result.affectedRows;
  }
};

module.exports = notificationModel;
