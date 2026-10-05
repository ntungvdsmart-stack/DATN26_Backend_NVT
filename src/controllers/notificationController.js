const NotificationModel = require('../models/notificationModel');
const { sendResponse } = require('../utils/responseHelper');

const notificationController = {
  // Lấy danh sách thông báo của user hiện tại
  getNotifications: async (req, res, next) => {
    try {
      const userId = req.user.user_id || req.user.id;
      const role = req.user.role; // 'customer', 'admin', 'staff'

      const notifications = await NotificationModel.getUserNotifications(userId, role);
      
      // Tính số lượng chưa đọc
      const unreadCount = notifications.filter(n => n.is_read === 0).length;

      res.json({
        success: true,
        data: notifications,
        unreadCount
      });
    } catch (error) {
      console.error('Error fetching notifications:', error);
      res.status(500).json({ success: false, message: 'Lỗi khi lấy thông báo' });
    }
  },

  // Đánh dấu 1 thông báo đã đọc
  markAsRead: async (req, res, next) => {
    try {
      const { id } = req.params;
      await NotificationModel.markAsRead(id);
      res.json({ success: true, message: 'Đã đánh dấu đọc' });
    } catch (error) {
      console.error('Error marking notification as read:', error);
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },

  // Đánh dấu tất cả đã đọc
  markAllAsRead: async (req, res, next) => {
    try {
      const userId = req.user.user_id || req.user.id;
      const role = req.user.role;

      await NotificationModel.markAllAsRead(userId, role);
      res.json({ success: true, message: 'Đã đánh dấu đọc tất cả' });
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  }
};

module.exports = notificationController;
