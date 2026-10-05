const pool = require('../config/database');
const { sendResponse } = require('../utils/responseHelper');

const InventoryController = {
  // Lấy toàn bộ tồn kho hoặc lọc theo branch
  getInventory: async (req, res, next) => {
    try {
      const { branch_id } = req.query;
      let query = `
        SELECT 
          i.inventory_id, i.quantity, i.updated_at,
          i.branch_id, b.branch_name,
          pv.variant_id, pv.sku, pv.price,
          p.product_name,
          s.size_value, c.color_name, m.material_name,
          (SELECT image_url FROM product_images pi WHERE pi.product_id = p.product_id AND pi.is_primary = 1 LIMIT 1) as image
        FROM inventory i
        JOIN product_variants pv ON i.variant_id = pv.variant_id
        JOIN products p ON pv.product_id = p.product_id
        JOIN branches b ON i.branch_id = b.branch_id
        LEFT JOIN sizes s ON pv.size_id = s.size_id
        LEFT JOIN colors c ON pv.color_id = c.color_id
        LEFT JOIN materials m ON pv.material_id = m.material_id
      `;
      let params = [];
      if (branch_id) {
        query += ` WHERE i.branch_id = ?`;
        params.push(branch_id);
      }
      query += ` ORDER BY p.product_name ASC, pv.sku ASC`;

      const [rows] = await pool.query(query, params);
      
      // Lấy danh sách chi nhánh để hiển thị filter
      const [branches] = await pool.query('SELECT * FROM branches WHERE is_active = 1');

      sendResponse(res, 200, true, 'OK', { inventory: rows, branches });
    } catch (error) {
      next(error);
    }
  },

  // Cập nhật số lượng tồn kho (Nhập/Xuất)
  updateInventory: async (req, res, next) => {
    try {
      const { inventory_id } = req.params;
      const { quantity, reason } = req.body;

      if (quantity === undefined || quantity < 0) {
        return sendResponse(res, 400, false, 'Số lượng không hợp lệ');
      }

      await pool.query('UPDATE inventory SET quantity = ? WHERE inventory_id = ?', [quantity, inventory_id]);
      
      // Ở hệ thống thực tế sẽ ghi log vào bảng inventory_transactions (lý do: reason), tạm thời chỉ update bảng inventory.

      sendResponse(res, 200, true, 'Cập nhật tồn kho thành công');
    } catch (error) {
      next(error);
    }
  },
  
  // Lấy chi tiết lịch sử (giả lập hoặc để dành cho tính năng sau)
};

module.exports = InventoryController;
