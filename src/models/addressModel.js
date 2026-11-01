const db = require('../config/database');

const addressModel = {
  updateAddress: async (customerId, addressId, data) => {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('SELECT customer_id FROM customers WHERE customer_id = ? FOR UPDATE', [customerId]);
      const [[existing]] = await connection.query('SELECT is_default FROM customer_addresses WHERE customer_id = ? AND address_id = ? FOR UPDATE', [customerId, addressId]);
      if (!existing) throw Object.assign(new Error('Không tìm thấy địa chỉ'), { statusCode: 404 });
      if (data.is_default) await connection.query('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?', [customerId]);
      await connection.query('UPDATE customer_addresses SET recipient_name=?, recipient_phone=?, full_address=?, ward=?, district=?, city=?, is_default=?, latitude=?, longitude=? WHERE customer_id=? AND address_id=?',
        [data.recipient_name.trim(), data.recipient_phone.trim(), data.full_address.trim(), data.ward || null, data.district || null, data.city || null, data.is_default || existing.is_default ? 1 : 0, data.latitude ?? null, data.longitude ?? null, customerId, addressId]);
      await connection.commit();
      return Number(addressId);
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  },
  getAddresses: async (customerId) => {
    const [rows] = await db.query('SELECT * FROM customer_addresses WHERE customer_id = ? ORDER BY is_default DESC, address_id DESC', [customerId]);
    return rows;
  },

  addAddress: async (customerId, data) => {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('SELECT customer_id FROM customers WHERE customer_id = ? FOR UPDATE', [customerId]);

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
        [customerId, data.recipient_name, data.recipient_phone, data.full_address, data.ward || null, data.district || null, data.city || null, data.is_default ? 1 : 0, data.latitude ?? null, data.longitude ?? null]
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
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('SELECT customer_id FROM customers WHERE customer_id = ? FOR UPDATE', [customerId]);
      const [[address]] = await connection.query('SELECT is_default FROM customer_addresses WHERE customer_id = ? AND address_id = ?', [customerId, addressId]);
      if (!address) { await connection.rollback(); return 0; }
      await connection.query('DELETE FROM customer_addresses WHERE customer_id = ? AND address_id = ?', [customerId, addressId]);
      if (address.is_default) await connection.query('UPDATE customer_addresses SET is_default = 1 WHERE customer_id = ? ORDER BY address_id DESC LIMIT 1', [customerId]);
      await connection.commit();
      return 1;
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  },

  setDefault: async (customerId, addressId) => {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('SELECT customer_id FROM customers WHERE customer_id = ? FOR UPDATE', [customerId]);
      const [[address]] = await connection.query('SELECT address_id FROM customer_addresses WHERE customer_id = ? AND address_id = ?', [customerId, addressId]);
      if (!address) throw Object.assign(new Error('Không tìm thấy địa chỉ'), { statusCode: 404 });
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
