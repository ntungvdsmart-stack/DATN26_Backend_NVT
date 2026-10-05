const db = require('../config/database');

const addressModel = {
  getAddresses: async (customerId) => {
    const [rows] = await db.query('SELECT * FROM customer_addresses WHERE customer_id = ? ORDER BY is_default DESC, address_id DESC', [customerId]);
    return rows;
  },

  addAddress: async (customerId, data) => {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // If is_default, unset others
      if (data.is_default) {
        await connection.query('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?', [customerId]);
      } else {
        // If it's the first address, make it default
        const [existing] = await connection.query('SELECT address_id FROM customer_addresses WHERE customer_id = ?', [customerId]);
        if (existing.length === 0) data.is_default = 1;
      }

      const [result] = await connection.query(
        'INSERT INTO customer_addresses (customer_id, recipient_name, recipient_phone, full_address, ward, district, city, is_default, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [customerId, data.recipient_name, data.recipient_phone, data.full_address, data.ward, data.district, data.city, data.is_default ? 1 : 0, data.latitude || null, data.longitude || null]
      );

      await connection.commit();
      return result.insertId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  deleteAddress: async (customerId, addressId) => {
    const [result] = await db.query('DELETE FROM customer_addresses WHERE customer_id = ? AND address_id = ?', [customerId, addressId]);
    return result.affectedRows;
  },

  setDefault: async (customerId, addressId) => {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?', [customerId]);
      await connection.query('UPDATE customer_addresses SET is_default = 1 WHERE customer_id = ? AND address_id = ?', [customerId, addressId]);
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
};

module.exports = addressModel;
