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
      query = 'SELECT n.*, o.order_code FROM notifications n LEFT JOIN orders o ON o.order_id=n.related_order_id WHERE n.customer_id = ? ORDER BY n.created_at DESC,n.notification_id DESC LIMIT 50';
      params = [userId];
    } else {
      // For admin/staff, we get notifications targeted to their account, or generic system notifications (where account_id IS NULL and customer_id IS NULL)
      query = 'SELECT n.*, o.order_code FROM notifications n LEFT JOIN orders o ON o.order_id=n.related_order_id WHERE n.account_id = ? ORDER BY n.created_at DESC,n.notification_id DESC LIMIT 50';
      params = [userId];
    }

    const [rows] = await db.query(query, params);
    return rows;
  },

  // Mark a single notification as read
  countUnread: async (userId, role) => {
    const column = role === 'customer' ? 'customer_id' : 'account_id';
    const [[row]] = await db.query(`SELECT COUNT(*) AS count FROM notifications WHERE ${column} = ? AND is_read = 0`, [userId]);
    return Number(row.count);
  },
  markAsRead: async (notificationId, userId, role) => {
    const column = role === 'customer' ? 'customer_id' : 'account_id';
    const [[owned]] = await db.query(`SELECT notification_id FROM notifications WHERE notification_id = ? AND ${column} = ?`, [notificationId, userId]);
    if (!owned) return false;
    await db.query(`UPDATE notifications SET is_read = 1 WHERE notification_id = ? AND ${column} = ?`, [notificationId, userId]);
    return true;
  },

  // Mark all notifications as read for a specific user
  markAllAsRead: async (userId, role, beforeId = null) => {
    let query = '';
    let params = [];

    if (role === 'customer') {
      query = 'UPDATE notifications SET is_read = 1 WHERE customer_id = ? AND is_read = 0';
      params = [userId];
    } else {
      query = 'UPDATE notifications SET is_read = 1 WHERE account_id = ? AND is_read = 0';
      params = [userId];
    }

    if (beforeId != null) { query += ' AND notification_id <= ?'; params.push(beforeId); }
    const [result] = await db.query(query, params);
    return result.affectedRows;
  }
};

module.exports = notificationModel;
