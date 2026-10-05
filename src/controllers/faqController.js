const faqModel = require('../models/faqModel');

const faqController = {
  // Public
  getActive: async (req, res) => {
    try {
      const items = await faqModel.getActiveFaqs();
      res.json({ success: true, data: items });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },

  // Admin
  getAll: async (req, res) => {
    try {
      const items = await faqModel.getAllFaqs();
      res.json({ success: true, data: items });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },
  create: async (req, res) => {
    try {
      await faqModel.createFaq(req.body);
      res.json({ success: true, message: 'Thêm FAQ thành công' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },
  update: async (req, res) => {
    try {
      await faqModel.updateFaq(req.params.id, req.body);
      res.json({ success: true, message: 'Cập nhật FAQ thành công' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },
  remove: async (req, res) => {
    try {
      await faqModel.deleteFaq(req.params.id);
      res.json({ success: true, message: 'Xóa FAQ thành công' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  }
};

module.exports = faqController;
