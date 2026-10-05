const promotionModel = require('../models/promotionModel');

const promotionController = {
  // --- ADMIN API ---
  getAll: async (req, res) => {
    try {
      const promotions = await promotionModel.getAll();
      res.json({ success: true, data: promotions });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Lỗi khi lấy danh sách mã giảm giá' });
    }
  },

  create: async (req, res) => {
    try {
      const data = req.body;
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
      res.status(500).json({ success: false, message: 'Lỗi khi tạo mã giảm giá' });
    }
  },

  update: async (req, res) => {
    try {
      const { id } = req.params;
      const data = req.body;
      
      const existing = await promotionModel.getById(id);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Không tìm thấy mã giảm giá' });
      }

      await promotionModel.update(id, data);
      res.json({ success: true, message: 'Cập nhật mã giảm giá thành công' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Lỗi khi cập nhật mã giảm giá' });
    }
  },

  delete: async (req, res) => {
    try {
      const { id } = req.params;
      await promotionModel.delete(id);
      res.json({ success: true, message: 'Xóa mã giảm giá thành công' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Lỗi khi xóa mã giảm giá. Có thể mã này đã được sử dụng.' });
    }
  },

  // --- PUBLIC API ---
  apply: async (req, res) => {
    try {
      const { code, subtotal, channel = 'both' } = req.body;
      const customerId = req.user ? req.user.userId : null;

      if (!code) {
        return res.status(400).json({ success: false, message: 'Vui lòng nhập mã giảm giá' });
      }

      const promo = await promotionModel.findByCode(code.toUpperCase());
      if (!promo) {
        return res.status(404).json({ success: false, message: 'Mã giảm giá không tồn tại' });
      }

      if (!promo.is_active) {
        return res.status(400).json({ success: false, message: 'Mã giảm giá đã bị khóa' });
      }

      const now = new Date();
      if (now < new Date(promo.start_date)) {
        return res.status(400).json({ success: false, message: 'Mã giảm giá chưa đến thời gian bắt đầu' });
      }
      if (now > new Date(promo.end_date)) {
        return res.status(400).json({ success: false, message: 'Mã giảm giá đã hết hạn' });
      }

      if (promo.channel_scope !== 'both' && promo.channel_scope !== channel) {
        return res.status(400).json({ success: false, message: 'Mã giảm giá không áp dụng cho kênh này' });
      }

      if (Number(subtotal) < Number(promo.min_order_amount)) {
        return res.status(400).json({ success: false, message: `Đơn hàng tối thiểu để áp dụng mã là ${Number(promo.min_order_amount).toLocaleString('vi-VN')}đ` });
      }

      const usageStats = await promotionModel.getUsageCount(promo.promotion_id, customerId);
      
      if (promo.max_usage_count !== null && usageStats.total >= promo.max_usage_count) {
        return res.status(400).json({ success: false, message: 'Mã giảm giá đã hết lượt sử dụng' });
      }

      if (customerId && usageStats.userCount >= promo.max_per_customer) {
        return res.status(400).json({ success: false, message: 'Bạn đã hết lượt sử dụng mã này' });
      }
      
      // Khách vãng lai cũng cho qua phần check userCount, chỉ check total count
      if (!customerId && promo.max_per_customer > 0 && false) { 
        // Not enforcing user limit for guests directly by ID, because they don't have an ID
      }

      // Tính toán số tiền được giảm
      let discountAmount = 0;
      if (promo.discount_type === 'percent') {
        discountAmount = (Number(subtotal) * Number(promo.discount_value)) / 100;
      } else {
        discountAmount = Number(promo.discount_value);
      }

      // Đảm bảo không giảm quá tổng tiền
      if (discountAmount > Number(subtotal)) {
        discountAmount = Number(subtotal);
      }

      res.json({
        success: true,
        message: 'Áp dụng mã thành công',
        data: {
          promotion_id: promo.promotion_id,
          promo_code: promo.promo_code,
          discount_type: promo.discount_type,
          discount_value: promo.discount_value,
          discount_amount: discountAmount
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Lỗi hệ thống khi áp dụng mã giảm giá' });
    }
  }
};

module.exports = promotionController;
