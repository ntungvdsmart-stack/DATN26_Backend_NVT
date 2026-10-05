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
  toggle: async (req, res) => {
    try {
      const { variant_id } = req.body;
      const customerId = req.user.user_id || req.user.id;
      
      const items = await wishlistModel.getWishlist(customerId);
      const isExist = items.some(i => i.variant_id === variant_id);

      if (isExist) {
        await wishlistModel.removeVariant(customerId, variant_id);
        res.json({ success: true, action: 'removed' });
      } else {
        await wishlistModel.addVariant(customerId, variant_id);
        res.json({ success: true, action: 'added' });
      }
    } catch (error) {
      res.status(500).json({ success: false, message: 'Lỗi server' });
    }
  }
};

module.exports = wishlistController;
