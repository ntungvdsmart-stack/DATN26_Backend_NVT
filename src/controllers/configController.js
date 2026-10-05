const pool = require('../config/database');
const { sendResponse } = require('../utils/responseHelper');

const ConfigController = {
  // Lấy tất cả cài đặt
  getSettings: async (req, res, next) => {
    try {
      const [rows] = await pool.query('SELECT setting_key, setting_value FROM system_settings');
      const settings = {};
      rows.forEach(row => {
        settings[row.setting_key] = row.setting_value;
      });
      sendResponse(res, 200, true, 'OK', settings);
    } catch (error) {
      next(error);
    }
  },

  // Cập nhật cài đặt (nhận một object { key1: val1, key2: val2 })
  updateSettings: async (req, res, next) => {
    try {
      const settings = req.body; // e.g. { store_name: "ABC", tax_rate: "10" }
      
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        
        for (const [key, value] of Object.entries(settings)) {
          await connection.query(
            'INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            [key, String(value), String(value)]
          );
        }
        
        await connection.commit();
        sendResponse(res, 200, true, 'Cập nhật cấu hình thành công');
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    } catch (error) {
      next(error);
    }
  }
};

module.exports = ConfigController;
