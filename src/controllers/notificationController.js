const NotificationModel = require('../models/notificationModel');
const { sendResponse } = require('../utils/responseHelper');

const notificationController = {
  // Lấy danh sách thông báo của user hiện tại
  getNotifications: async (req, res, next) => {
    try {
      const userId = req.user.user_id || req.user.id;
      const role = req.user.role; // 'customer', 'admin', 'staff'

      const [notifications, unreadCount] = await Promise.all([NotificationModel.getUserNotifications(userId, role), NotificationModel.countUnread(userId, role)]);
      
      // Tính số lượng chưa đọc

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
      if (!await NotificationModel.markAsRead(id, req.user.id, req.user.role)) return res.status(404).json({ success: false, message: 'Không tìm thấy thông báo của bạn' });
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

      const beforeId = req.body?.before_id;
      if (beforeId != null && (!/^[1-9]\d*$/.test(String(beforeId)) || !Number.isSafeInteger(Number(beforeId)))) return res.status(400).json({ success: false, message: 'Mã thông báo không hợp lệ' });
      await NotificationModel.markAllAsRead(userId, role, beforeId ?? null);
      res.json({ success: true, message: 'Đã đánh dấu đọc tất cả' });
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  }
};

module.exports = notificationController;
