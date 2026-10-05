const addressModel = require('../models/addressModel');

const addressController = {
  get: async (req, res) => {
    try {
      const items = await addressModel.getAddresses(req.user.user_id || req.user.id);
      res.json({ success: true, data: items });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },
  add: async (req, res) => {
    try {
      await addressModel.addAddress(req.user.user_id || req.user.id, req.body);
      res.json({ success: true, message: 'Thêm địa chỉ thành công' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },
  remove: async (req, res) => {
    try {
      await addressModel.deleteAddress(req.user.user_id || req.user.id, req.params.id);
      res.json({ success: true, message: 'Xóa địa chỉ thành công' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },
  setDefault: async (req, res) => {
    try {
      await addressModel.setDefault(req.user.user_id || req.user.id, req.params.id);
      res.json({ success: true, message: 'Đã đặt làm mặc định' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  }
};

module.exports = addressController;
