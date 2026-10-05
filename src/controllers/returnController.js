const returnModel = require('../models/returnModel');
const { sendResponse } = require('../utils/responseHelper');

const returnController = {
  // Client tạo yêu cầu trả hàng
  createRequest: async (req, res, next) => {
    try {
      const { order_id, return_type, reason, items } = req.body;
      // items là mảng các object: { order_item_id, quantity }

      if (!order_id || !items || items.length === 0) {
        return res.status(400).json({ success: false, message: 'Thiếu thông tin sản phẩm cần trả' });
      }

      await returnModel.createReturnRequest({ order_id, return_type, reason, items });
      res.json({ success: true, message: 'Gửi yêu cầu đổi/trả hàng thành công' });
    } catch (error) {
      console.error('Error creating return request:', error);
      res.status(400).json({ success: false, message: error.message || 'Lỗi khi gửi yêu cầu' });
    }
  },

  // Admin lấy danh sách yêu cầu
  getAll: async (req, res, next) => {
    try {
      const returns = await returnModel.getAllReturns();
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

      await returnModel.updateReturnStatus(id, status, accountId);
      res.json({ success: true, message: 'Cập nhật trạng thái thành công' });
    } catch (error) {
      console.error('Error updating return status:', error);
      res.status(500).json({ success: false, message: error.message || 'Lỗi server' });
    }
  }
};

module.exports = returnController;
