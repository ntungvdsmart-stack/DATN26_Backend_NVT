const wishlistModel = require('../models/wishlistModel');

const wishlistController = {
  get: async (req, res) => {
    try {
      const items = await wishlistModel.getWishlist(req.user.user_id || req.user.id);
      res.json({ success: true, data: items });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  },
  toggle: async (req, res, next) => {
    try {
      const value = req.body.variant_id;
      if (!['number', 'string'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value))) return res.status(400).json({ success: false, message: 'Biến thể không hợp lệ' });
      const variant_id = Number(value);
      if (!Number.isSafeInteger(variant_id) || variant_id <= 0) return res.status(400).json({ success: false, message: 'Biến thể không hợp lệ' });
      const customerId = req.user.user_id || req.user.id;
      
      const action = await wishlistModel.toggleVariant(customerId, variant_id);
      res.json({ success: true, action });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = wishlistController;
