const pool = require('../config/database');
const { sendResponse } = require('../utils/responseHelper');

const ConfigController = {
  // Lấy tất cả cài đặt
  getSettings: async (req, res, next) => {
    try {
      const [rows] = await pool.query('SELECT setting_key, setting_value FROM system_settings');
      const settings = {};
      rows.forEach(row => {
        if (/(secret|password|api_key|access_token)/i.test(row.setting_key)) return;
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
      if (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.keys(settings).length > 50) return sendResponse(res, 400, false, 'Cấu hình không hợp lệ');
      for (const [key, value] of Object.entries(settings)) {
        if (/(secret|password|api_key|access_token)/i.test(key)) return sendResponse(res, 400, false, 'Không lưu khóa bí mật trong cấu hình công khai');
        if (!/^[a-z][a-z0-9_]{0,99}$/.test(key) || !['string', 'number', 'boolean'].includes(typeof value) || String(value).length > 10000) return sendResponse(res, 400, false, 'Giá trị cấu hình không hợp lệ');
        if (['shipping_fee', 'free_shipping_threshold', 'tax_rate'].includes(key) && (!['string', 'number'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > (key === 'tax_rate' ? 100 : 9999999999) || (key !== 'tax_rate' && !Number.isSafeInteger(Number(value))))) return sendResponse(res, 400, false, 'Phí và ngưỡng miễn phí phải là số nguyên không âm, tối đa 9.999.999.999; thuế từ 0 đến 100%');
        if (key === 'store_phone' && value && (typeof value !== 'string' || !/^(0\d{9}|\+84\d{9})$/.test(value))) return sendResponse(res, 400, false, 'Số điện thoại cửa hàng không hợp lệ');
        if (['store_name', 'store_email', 'store_address', 'store_phone', 'store_logo_url', 'bank_account_name', 'bank_account_number', 'bank_bin'].includes(key) && typeof value !== 'string') return sendResponse(res, 400, false, 'Thông tin cửa hàng và ngân hàng phải là chuỗi ký tự');
        if (key === 'store_email' && String(value).length > 150) return sendResponse(res, 400, false, 'Email hỗ trợ tối đa 150 ký tự');
        if (key === 'store_address' && String(value).length > 255) return sendResponse(res, 400, false, 'Địa chỉ cửa hàng tối đa 255 ký tự');
        if (key === 'bank_bin' && value && !/^\d{6}$/.test(String(value))) return sendResponse(res, 400, false, 'Mã BIN ngân hàng gồm 6 chữ số');
        if (key === 'bank_account_number' && value && !/^[A-Za-z0-9]{4,30}$/.test(String(value))) return sendResponse(res, 400, false, 'Số tài khoản không hợp lệ');
        if (key === 'store_logo_url' && value) {
          try {
            const logo = new URL(String(value));
            if (logo.protocol !== 'https:' || logo.username || logo.password || String(value).length > 1000) throw new Error();
          } catch { return sendResponse(res, 400, false, 'Logo email cần đường dẫn HTTPS công khai, tối đa 1000 ký tự'); }
        }
        if (key === 'store_name' && (!String(value).trim() || String(value).length > 150 || /[\r\n]/.test(String(value)))) return sendResponse(res, 400, false, 'Tên cửa hàng cần từ 1 đến 150 ký tự');
        if (key === 'store_email' && value && !/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(String(value))) return sendResponse(res, 400, false, 'Email hỗ trợ không hợp lệ');
      }
      
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
