const promotionModel = require('../models/promotionModel');
const validatePromotion = (data) => {
  if (data.is_active != null && ![true, false, 0, 1].includes(data.is_active)) return 'Trạng thái khuyến mãi không hợp lệ';
  if (typeof data.promo_code !== 'string' || !/^[A-Za-z0-9_-]{2,50}$/.test(data.promo_code) || typeof data.promo_name !== 'string' || !data.promo_name.trim() || data.promo_name.length > 150) return 'Mã khuyến mãi 2–50 ký tự; tên tối đa 150 ký tự';
  if (!['percent', 'amount'].includes(data.discount_type) || !Number.isFinite(Number(data.discount_value)) || Number(data.discount_value) <= 0 || (data.discount_type === 'percent' && Number(data.discount_value) > 100)) return 'Giá trị giảm phải lớn hơn 0; phần trăm không vượt quá 100';
  if (!['online', 'pos', 'both'].includes(data.channel_scope || 'both')) return 'Kênh áp dụng không hợp lệ';
  if (!Number.isFinite(Date.parse(data.start_date)) || !Number.isFinite(Date.parse(data.end_date)) || new Date(data.start_date) >= new Date(data.end_date)) return 'Ngày kết thúc phải sau ngày bắt đầu';
  if (!Number.isFinite(Number(data.min_order_amount || 0)) || Number(data.min_order_amount || 0) < 0) return 'Giá trị đơn tối thiểu không hợp lệ';
  for (const key of ['max_usage_count', 'max_per_customer']) if (data[key] != null && data[key] !== '' && (!Number.isSafeInteger(Number(data[key])) || Number(data[key]) <= 0)) return 'Giới hạn sử dụng phải là số nguyên dương';
  return null;
};

const promotionController = {
  // --- ADMIN API ---
  getAll: async (req, res) => {
    try {
      const promotions = await promotionModel.getAll();
      res.json({ success: true, data: promotions });
    } catch (error) {
      console.error(error);
      res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Lỗi khi lấy danh sách mã giảm giá' });
    }
  },

  create: async (req, res) => {
    try {
      const data = req.body;
      const validation = validatePromotion(data);
      if (validation) return res.status(400).json({ success: false, message: validation });
      data.promo_code = data.promo_code.trim().toUpperCase();
      // Validate
      if (!data.promo_code || !data.promo_name || !data.discount_value || !data.start_date || !data.end_date) {
        return res.status(400).json({ success: false, message: 'Vui lòng nhập đủ thông tin bắt buộc' });
      }
      
      const exists = await promotionModel.findByCode(data.promo_code);
      if (exists) {
        return res.status(400).json({ success: false, message: 'Mã giảm giá đã tồn tại' });
      }

      await promotionModel.create(data);
      res.json({ success: true, message: 'Thêm mã giảm giá thành công' });
    } catch (error) {
      console.error(error);
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Mã giảm giá đã tồn tại' });
      res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Lỗi khi tạo mã giảm giá' });
    }
  },

  update: async (req, res) => {
    try {
      const { id } = req.params;
      const data = req.body;
      const validation = validatePromotion(data);
      if (validation) return res.status(400).json({ success: false, message: validation });
      data.promo_code = data.promo_code.trim().toUpperCase();
      
      const existing = await promotionModel.getById(id);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Không tìm thấy mã giảm giá' });
      }

      await promotionModel.update(id, { ...existing, ...data, min_order_amount: data.min_order_amount ?? existing.min_order_amount });
      res.json({ success: true, message: 'Cập nhật mã giảm giá thành công' });
    } catch (error) {
      console.error(error);
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'Mã giảm giá đã tồn tại' });
      res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Lỗi khi cập nhật mã giảm giá' });
    }
  },

  delete: async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!await promotionModel.delete(id, req.user.id)) return res.status(404).json({ success: false, message: 'Không tìm thấy mã giảm giá' });
      res.json({ success: true, message: 'Xóa mã giảm giá thành công' });
    } catch (error) {
      next(error);
    }
  },

  // --- PUBLIC API ---
  apply: async (req, res) => {
    try {
      const { code, subtotal, channel = 'online' } = req.body;
      if (typeof code !== 'string' || !code.trim() || code.length > 50 || !['number', 'string'].includes(typeof subtotal) || String(subtotal).trim() === '' || !Number.isFinite(Number(subtotal)) || Number(subtotal) < 0 || !['online', 'pos'].includes(channel)) {
        return res.status(400).json({ success: false, message: 'Mã ưu đãi tối đa 50 ký tự, số tiền không âm và kênh mua hàng hợp lệ là bắt buộc' });
      }
      const promo = await require('../services/orderService').evaluatePromotion({ code, subtotal: Number(subtotal), channel, customerId: req.user?.role === 'customer' ? req.user.id : null });
      res.json({ success: true, data: promo });
    } catch (error) {
      console.error(error);
      res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : 'Lỗi hệ thống khi áp dụng mã giảm giá' });
    }
  }
};

module.exports = promotionController;
