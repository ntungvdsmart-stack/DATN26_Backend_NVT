const pool = require('../config/database');

const returnModel = {
  // Khách hàng tạo yêu cầu trả hàng
  createReturnRequest: async (data) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Kiểm tra đơn hàng có tồn tại và đã completed chưa
      const [order] = await connection.query('SELECT order_status, customer_id FROM orders WHERE order_id = ?', [data.order_id]);
      if (order.length === 0 || order[0].order_status !== 'completed') {
        throw new Error('Chỉ có thể yêu cầu trả hàng cho đơn hàng đã hoàn tất.');
      }

      // Tạo record ở bảng order_returns
      const [returnResult] = await connection.query(
        'INSERT INTO order_returns (order_id, return_type, reason, status) VALUES (?, ?, ?, ?)',
        [data.order_id, data.return_type || 'return', data.reason, 'requested']
      );
      const returnId = returnResult.insertId;

      // Tạo các record ở bảng order_return_items
      for (const item of data.items) {
        await connection.query(
          'INSERT INTO order_return_items (return_id, order_item_id, quantity) VALUES (?, ?, ?)',
          [returnId, item.order_item_id, item.quantity]
        );
      }

      // Gửi thông báo cho Admin
      await connection.query(
        `INSERT INTO notifications (notif_type, content, related_order_id, is_read) VALUES (?, ?, ?, 0)`,
        ['return_request', `Có yêu cầu đổi/trả mới cho đơn hàng ${data.order_id}`, data.order_id]
      );

      await connection.commit();
      return returnId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  // Admin lấy danh sách các yêu cầu trả hàng
  getAllReturns: async () => {
    const [rows] = await pool.query(`
      SELECT r.*, o.order_code, c.full_name as customer_name, c.phone as customer_phone
      FROM order_returns r
      JOIN orders o ON r.order_id = o.order_id
      LEFT JOIN customers c ON o.customer_id = c.customer_id
      ORDER BY r.created_at DESC
    `);

    // Lấy thêm chi tiết các mặt hàng
    for (const ret of rows) {
      const [items] = await pool.query(`
        SELECT ri.*, oi.unit_price, pv.size, pv.color, p.product_name 
        FROM order_return_items ri
        JOIN order_items oi ON ri.order_item_id = oi.order_item_id
        JOIN product_variants pv ON oi.variant_id = pv.variant_id
        JOIN products p ON pv.product_id = p.product_id
        WHERE ri.return_id = ?
      `, [ret.return_id]);
      ret.items = items;
    }

    return rows;
  },

  // Admin cập nhật trạng thái yêu cầu
  updateReturnStatus: async (returnId, newStatus, accountId) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [retData] = await connection.query('SELECT * FROM order_returns WHERE return_id = ? FOR UPDATE', [returnId]);
      if (retData.length === 0) throw new Error('Không tìm thấy yêu cầu trả hàng');
      
      const currentStatus = retData[0].status;
      if (currentStatus === newStatus) return true;

      // Cập nhật trạng thái
      await connection.query(
        'UPDATE order_returns SET status = ?, processed_by = ? WHERE return_id = ?',
        [newStatus, accountId, returnId]
      );

      // Nếu trạng thái chuyển sang completed (Đã nhận lại hàng)
      if (newStatus === 'completed' && currentStatus !== 'completed') {
        const orderId = retData[0].order_id;
        const [items] = await connection.query('SELECT * FROM order_return_items WHERE return_id = ?', [returnId]);
        
        let totalRefundAmount = 0;

        for (const item of items) {
          // Lấy variant_id và giá của item này
          const [oiData] = await connection.query('SELECT variant_id, unit_price FROM order_items WHERE order_item_id = ?', [item.order_item_id]);
          if (oiData.length > 0) {
            const variantId = oiData[0].variant_id;
            const price = oiData[0].unit_price;
            totalRefundAmount += (price * item.quantity);

            // Cộng lại kho (Giả sử kho mặc định là branch_id = 1)
            await connection.query(
              'UPDATE inventory SET quantity = quantity + ? WHERE variant_id = ? AND branch_id = 1',
              [item.quantity, variantId]
            );
          }
        }

        // Tạo record hoàn tiền (payment_refunds)
        if (retData[0].return_type === 'return' && totalRefundAmount > 0) {
          // Lấy payment_id của đơn hàng này
          const [payment] = await connection.query('SELECT payment_id FROM payments WHERE order_id = ? LIMIT 1', [orderId]);
          if (payment.length > 0) {
            await connection.query(
              'INSERT INTO payment_refunds (payment_id, amount, reason, status, processed_by) VALUES (?, ?, ?, ?, ?)',
              [payment[0].payment_id, totalRefundAmount, retData[0].reason, 'completed', accountId]
            );
          }
        }

        // Cập nhật trạng thái đơn hàng thành 'returned' nếu trả toàn bộ (Ở đây đơn giản hóa là cập nhật luôn trạng thái)
        await connection.query('UPDATE orders SET order_status = ? WHERE order_id = ?', ['returned', orderId]);

        // Thông báo cho khách hàng
        const [orderInfo] = await connection.query('SELECT customer_id, order_code FROM orders WHERE order_id = ?', [orderId]);
        if (orderInfo.length > 0 && orderInfo[0].customer_id) {
          await connection.query(
            'INSERT INTO notifications (customer_id, notif_type, content, related_order_id, is_read) VALUES (?, ?, ?, ?, 0)',
            [orderInfo[0].customer_id, 'return_completed', `Yêu cầu trả hàng cho đơn ${orderInfo[0].order_code} đã hoàn tất. Chúng tôi đã cộng lại số lượng vào kho và thực hiện hoàn tiền.`, orderId]
          );
        }
      }

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

module.exports = returnModel;
