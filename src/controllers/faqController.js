const faqModel = require('../models/faqModel');
const validFaq = data => typeof data.question === 'string' && data.question.trim().length > 0 && data.question.length <= 500 && typeof data.answer === 'string' && data.answer.trim().length > 0 && data.answer.length <= 20000 && (data.is_active == null || [true,false,0,1].includes(data.is_active));

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
      if (!validFaq(req.body)) return res.status(400).json({ success: false, message: 'Nhập câu hỏi (tối đa 500 ký tự), câu trả lời và trạng thái hợp lệ' });
      const id = await faqModel.createFaq(req.body);
      res.json({ success: true, message: 'Thêm FAQ thành công', data: { faq_id: id } });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },
  update: async (req, res) => {
    try {
      if (!validFaq(req.body)) return res.status(400).json({ success: false, message: 'Câu hỏi, câu trả lời hoặc trạng thái không hợp lệ' });
      if (!await faqModel.updateFaq(req.params.id, { ...req.body, is_active: req.body.is_active ?? 1 })) return res.status(404).json({ success: false, message: 'Không tìm thấy FAQ' });
      res.json({ success: true, message: 'Cập nhật FAQ thành công' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },
  remove: async (req, res, next) => {
    try {
      if (!await faqModel.deleteFaq(req.params.id, req.user.id)) return res.status(404).json({ success: false, message: 'Không tìm thấy FAQ' });
      res.json({ success: true, message: 'Xóa FAQ thành công' });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = faqController;
