const db = require('../config/database');

const promotionModel = {
  getAll: async () => {
    const [rows] = await db.query('SELECT * FROM promotions ORDER BY promotion_id DESC');
    return rows;
  },

  getById: async (id) => {
    const [rows] = await db.query('SELECT * FROM promotions WHERE promotion_id = ?', [id]);
    return rows[0];
  },

  findByCode: async (code) => {
    const [rows] = await db.query('SELECT * FROM promotions WHERE promo_code = ?', [code]);
    return rows[0];
  },

  create: async (data) => {
    const [result] = await db.query(`
      INSERT INTO promotions 
      (promo_code, promo_name, discount_type, discount_value, channel_scope, min_order_amount, max_usage_count, max_per_customer, start_date, end_date, is_active) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      data.promo_code, data.promo_name, data.discount_type, data.discount_value, 
      data.channel_scope || 'both', data.min_order_amount || 0, data.max_usage_count || null, 
      data.max_per_customer || 1, data.start_date, data.end_date, data.is_active !== undefined ? data.is_active : 1
    ]);
    return result.insertId;
  },

  update: async (id, data) => {
    const [result] = await db.query(`
      UPDATE promotions SET 
      promo_code = ?, promo_name = ?, discount_type = ?, discount_value = ?, 
      channel_scope = ?, min_order_amount = ?, max_usage_count = ?, 
      max_per_customer = ?, start_date = ?, end_date = ?, is_active = ?
      WHERE promotion_id = ?
    `, [
      data.promo_code, data.promo_name, data.discount_type, data.discount_value, 
      data.channel_scope, data.min_order_amount, data.max_usage_count, 
      data.max_per_customer, data.start_date, data.end_date, data.is_active, id
    ]);
    return result.affectedRows;
  },

  delete: async (id) => {
    const [result] = await db.query('DELETE FROM promotions WHERE promotion_id = ?', [id]);
    return result.affectedRows;
  },

  getUsageCount: async (promotionId, customerId = null) => {
    // Total usage overall
    const [totalRows] = await db.query('SELECT COUNT(*) as total FROM order_promotions WHERE promotion_id = ?', [promotionId]);
    
    // Usage by specific customer
    let userCount = 0;
    if (customerId) {
      const [userRows] = await db.query(`
        SELECT COUNT(*) as count 
        FROM order_promotions op
        JOIN orders o ON op.order_id = o.order_id
        WHERE op.promotion_id = ? AND o.customer_id = ?
      `, [promotionId, customerId]);
      userCount = userRows[0].count;
    }

    return {
      total: totalRows[0].total,
      userCount: userCount
    };
  }
};

module.exports = promotionModel;
