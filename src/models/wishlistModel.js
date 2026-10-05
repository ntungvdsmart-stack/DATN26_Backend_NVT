const db = require('../config/database');

const wishlistModel = {
  getWishlist: async (customerId) => {
    const [rows] = await db.query(`
      SELECT 
        w.wishlist_id, w.variant_id, p.product_name, p.product_id, pv.price, 
        c.color_name as color, s.size_value as size,
        (SELECT image_url FROM product_images pi WHERE pi.product_id = p.product_id AND (pi.variant_id = pv.variant_id OR pi.is_primary = 1) ORDER BY pi.variant_id = pv.variant_id DESC, pi.is_primary DESC LIMIT 1) as image_url
      FROM wishlists w
      JOIN product_variants pv ON w.variant_id = pv.variant_id
      JOIN products p ON pv.product_id = p.product_id
      LEFT JOIN colors c ON pv.color_id = c.color_id
      LEFT JOIN sizes s ON pv.size_id = s.size_id
      WHERE w.customer_id = ?
      ORDER BY w.added_at DESC
    `, [customerId]);
    return rows;
  },

  addVariant: async (customerId, variantId) => {
    // Check if exists
    const [existing] = await db.query('SELECT wishlist_id FROM wishlists WHERE customer_id = ? AND variant_id = ?', [customerId, variantId]);
    if (existing.length > 0) return existing[0].wishlist_id;

    const [result] = await db.query(
      'INSERT INTO wishlists (customer_id, variant_id) VALUES (?, ?)',
      [customerId, variantId]
    );
    return result.insertId;
  },

  removeVariant: async (customerId, variantId) => {
    const [result] = await db.query(
      'DELETE FROM wishlists WHERE customer_id = ? AND variant_id = ?',
      [customerId, variantId]
    );
    return result.affectedRows;
  }
};

module.exports = wishlistModel;
