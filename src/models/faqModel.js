const db = require('../config/database');

const faqModel = {
  // Public
  getActiveFaqs: async () => {
    const [rows] = await db.query('SELECT * FROM faqs WHERE is_active = 1 ORDER BY faq_id DESC');
    return rows;
  },

  // Admin
  getAllFaqs: async () => {
    const [rows] = await db.query('SELECT * FROM faqs ORDER BY faq_id DESC');
    return rows;
  },
  
  createFaq: async (data) => {
    const [result] = await db.query(
      'INSERT INTO faqs (question, answer, is_active) VALUES (?, ?, ?)',
      [data.question, data.answer, data.is_active !== undefined ? data.is_active : 1]
    );
    return result.insertId;
  },

  updateFaq: async (id, data) => {
    const [result] = await db.query(
      'UPDATE faqs SET question = ?, answer = ?, is_active = ? WHERE faq_id = ?',
      [data.question, data.answer, data.is_active, id]
    );
    return result.affectedRows;
  },

  deleteFaq: async (id) => {
    const [result] = await db.query('DELETE FROM faqs WHERE faq_id = ?', [id]);
    return result.affectedRows;
  }
};

module.exports = faqModel;
