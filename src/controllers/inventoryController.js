const pool = require('../config/database');
const { sendResponse } = require('../utils/responseHelper');

const InventoryController = {
  // Lấy toàn bộ tồn kho hoặc lọc theo branch
  getInventory: async (req, res, next) => {
    try {
      const branch_id = req.user.role === 'staff' ? req.user.branch_id : req.query.branch_id;
      if (req.user.role === 'staff' && !branch_id) return sendResponse(res, 403, false, 'Nhân viên chưa được phân công chi nhánh');
      let query = `
        SELECT 
          i.inventory_id, COALESCE(i.quantity, 0) AS quantity, i.updated_at,
          b.branch_id, b.branch_name,
          pv.variant_id, pv.sku, pv.price,
          p.product_id, p.product_name,
          s.size_value, c.color_name, m.material_name,
          (SELECT image_url FROM product_images pi WHERE pi.product_id = p.product_id AND pi.is_primary = 1 LIMIT 1) as image
        FROM product_variants pv
        CROSS JOIN branches b
        LEFT JOIN inventory i ON i.variant_id = pv.variant_id AND i.branch_id = b.branch_id
        JOIN products p ON pv.product_id = p.product_id
        LEFT JOIN sizes s ON pv.size_id = s.size_id
        LEFT JOIN colors c ON pv.color_id = c.color_id
        LEFT JOIN materials m ON pv.material_id = m.material_id
      `;
      let params = [];
      if (branch_id) {
        query += ` WHERE b.branch_id = ?`;
        params.push(branch_id);
      }
      query += ` ORDER BY p.product_name ASC, pv.sku ASC`;

      const [rows] = await pool.query(query, params);
      
      // Lấy danh sách chi nhánh để hiển thị filter
      const [branches] = await pool.query(`SELECT * FROM branches WHERE is_active = 1${req.user.role === 'staff' ? ' AND branch_id = ?' : ''}`, req.user.role === 'staff' ? [branch_id] : []);

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
      const receiving = req.inventoryOperation === 'receive';

      if (!['number', 'string'].includes(typeof quantity) || String(quantity).trim() === '' || !Number.isSafeInteger(Number(quantity)) || Number(quantity) < 0 || Number(quantity) > 2147483647) {
        return sendResponse(res, 400, false, 'Số lượng không hợp lệ');
      }

      if (receiving && Number(quantity) <= 0) return sendResponse(res, 400, false, 'Số lượng nhập phải lớn hơn 0');
      if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 300) {
        return sendResponse(res, 400, false, 'Vui lòng nhập lý do điều chỉnh (tối đa 300 ký tự)');
      }
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        let item;
        if (inventory_id) {
          [[item]] = await connection.query('SELECT i.* FROM inventory i JOIN branches b ON b.branch_id = i.branch_id AND b.is_active = 1 WHERE i.inventory_id = ? FOR UPDATE', [inventory_id]);
        } else {
          const variantId = Number(req.params.variant_id), branchId = Number(req.params.branch_id);
          if (!Number.isSafeInteger(variantId) || variantId <= 0 || !Number.isSafeInteger(branchId) || branchId <= 0) throw Object.assign(new Error('Biến thể và chi nhánh không hợp lệ'), { statusCode: 400 });
          const [[branch]] = await connection.query('SELECT branch_id FROM branches WHERE branch_id = ? AND is_active = 1', [branchId]);
          if (!branch) throw Object.assign(new Error('Chi nhánh không tồn tại hoặc đã ngừng hoạt động'), { statusCode: 400 });
          await connection.query('INSERT INTO inventory (variant_id, branch_id, quantity) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE inventory_id = inventory_id', [variantId, branchId]);
          [[item]] = await connection.query('SELECT * FROM inventory WHERE variant_id = ? AND branch_id = ? FOR UPDATE', [variantId, branchId]);
        }
        if (!item) {
          await connection.rollback();
          return sendResponse(res, 404, false, 'Không tìm thấy tồn kho');
        }
        if (req.user.role !== 'admin' && Number(item.branch_id) !== Number(req.user.branch_id)) {
          await connection.rollback();
          return sendResponse(res, 403, false, 'Chỉ được điều chỉnh kho của chi nhánh được phân công');
        }
        if (!receiving && req.body.expected_quantity !== undefined && Number(req.body.expected_quantity) !== Number(item.quantity)) {
          await connection.rollback();
          return sendResponse(res, 409, false, 'Tồn kho đã thay đổi. Vui lòng tải lại trước khi điều chỉnh');
        }
        const finalQuantity = receiving ? Number(item.quantity) + Number(quantity) : Number(quantity);
        if (finalQuantity > 2147483647) throw Object.assign(new Error('Tồn kho vượt giới hạn cho phép'), { statusCode: 400 });
        await connection.query('UPDATE inventory SET quantity = ? WHERE inventory_id = ?', [finalQuantity, item.inventory_id]);
        await connection.query(
          'INSERT INTO activity_logs (account_id, action, target_table, target_id, description, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
          [req.user.id, receiving ? 'RECEIVE_STOCK' : 'UPDATE_INVENTORY', 'inventory', item.inventory_id, `${item.quantity} → ${finalQuantity}: ${reason.trim()}`, req.ip]
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      sendResponse(res, 200, true, 'Cập nhật tồn kho thành công');
    } catch (error) {
      next(error);
    }
  },
  
  // Lấy chi tiết lịch sử (giả lập hoặc để dành cho tính năng sau)
};

module.exports = InventoryController;
