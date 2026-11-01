const returnModel = require('../models/returnModel');
const { sendResponse } = require('../utils/responseHelper');

const returnController = {
  // Client tạo yêu cầu trả hàng
  createRequest: async (req, res, next) => {
    try {
      const { order_id, return_type, reason, items } = req.body;
      // items là mảng các object: { order_item_id, quantity }

      if (!order_id || !Array.isArray(items) || items.length === 0 || items.length > 100 || typeof reason !== 'string' || !reason.trim() || reason.length > 255 || !['return', 'exchange'].includes(return_type || 'return')) {
        return res.status(400).json({ success: false, message: 'Thiếu thông tin sản phẩm cần trả' });
      }

      await returnModel.createReturnRequest({ order_id, return_type, reason: reason.trim(), items, actor: req.user });
      res.json({ success: true, message: 'Gửi yêu cầu đổi/trả hàng thành công' });
    } catch (error) {
      console.error('Error creating return request:', error);
      if (!error.code) error.statusCode ||= 400;
      next(error);
    }
  },

  // Admin lấy danh sách yêu cầu
  getAll: async (req, res, next) => {
    try {
      const returns = await returnModel.getAllReturns(req.user.role === 'staff' ? req.user.branch_id || -1 : null);
      res.json({ success: true, data: returns });
    } catch (error) {
      console.error('Error fetching returns:', error);
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },

  // Admin cập nhật trạng thái yêu cầu
  updateStatus: async (req, res, next) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const accountId = req.user.user_id || req.user.id;

      if (!['approved', 'rejected', 'completed'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Trạng thái không hợp lệ' });
      }

      await returnModel.updateReturnStatus(id, status, accountId, req.body.exchanges || {}, req.user);
      res.json({ success: true, message: 'Cập nhật trạng thái thành công' });
    } catch (error) {
      console.error('Error updating return status:', error);
      if (!error.code) error.statusCode ||= 400;
      next(error);
    }
  }
};

module.exports = returnController;
