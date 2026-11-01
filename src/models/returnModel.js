const pool = require('../config/database');

const returnModel = {
  // Khách hàng tạo yêu cầu trả hàng
  createReturnRequest: async (data) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Kiểm tra đơn hàng có tồn tại và đã completed chưa
      const [order] = await connection.query('SELECT order_status, customer_id, branch_id FROM orders WHERE order_id = ? FOR UPDATE', [data.order_id]);
      if (order.length === 0 || order[0].order_status !== 'completed') {
        throw new Error('Chỉ có thể yêu cầu trả hàng cho đơn hàng đã hoàn tất.');
      }
      if (data.actor.role === 'customer' && Number(order[0].customer_id) !== Number(data.actor.id)) throw new Error('Bạn không có quyền đổi/trả đơn hàng này');
      if (data.actor.role === 'staff' && Number(order[0].branch_id) !== Number(data.actor.branch_id)) throw Object.assign(new Error('Không được tạo yêu cầu cho chi nhánh khác'), { statusCode: 403 });
      const ids = new Set();
      for (const item of data.items) {
        if (!Number.isSafeInteger(Number(item.order_item_id)) || !Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) <= 0 || ids.has(Number(item.order_item_id))) throw new Error('Sản phẩm hoặc số lượng trả không hợp lệ');
        ids.add(Number(item.order_item_id));
        const [[line]] = await connection.query('SELECT quantity FROM order_items WHERE order_id = ? AND order_item_id = ?', [data.order_id, item.order_item_id]);
        const [[used]] = await connection.query("SELECT COALESCE(SUM(ri.quantity),0) AS quantity FROM order_return_items ri JOIN order_returns r ON r.return_id = ri.return_id WHERE ri.order_item_id = ? AND r.status <> 'rejected'", [item.order_item_id]);
        if (!line || Number(item.quantity) + Number(used.quantity) > Number(line.quantity)) throw new Error('Số lượng trả vượt quá số lượng đã mua hoặc đã yêu cầu trả');
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
        `INSERT INTO notifications (account_id, notif_type, content, related_order_id, is_read) SELECT account_id, ?, ?, ?, 0 FROM accounts WHERE role_id = 1 AND is_active = 1`,
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
  getAllReturns: async (branchId = null) => {
    const [rows] = await pool.query(`
      SELECT r.*, o.order_code, o.branch_id, c.full_name as customer_name, c.phone as customer_phone
      FROM order_returns r
      JOIN orders o ON r.order_id = o.order_id
      LEFT JOIN customers c ON o.customer_id = c.customer_id
      WHERE (? IS NULL OR o.branch_id = ?)
      ORDER BY r.created_at DESC
    `, [branchId, branchId]);

    // Lấy thêm chi tiết các mặt hàng
    for (const ret of rows) {
      const [items] = await pool.query(`
        SELECT ri.*, oi.variant_id, oi.unit_price, s.size_value AS size, c.color_name AS color, p.product_id, p.product_name 
        FROM order_return_items ri
        JOIN order_items oi ON ri.order_item_id = oi.order_item_id
        JOIN product_variants pv ON oi.variant_id = pv.variant_id
        JOIN products p ON pv.product_id = p.product_id
        LEFT JOIN sizes s ON s.size_id = pv.size_id
        LEFT JOIN colors c ON c.color_id = pv.color_id
        WHERE ri.return_id = ?
      `, [ret.return_id]);
      ret.items = items;
    }

    return rows;
  },

  // Admin cập nhật trạng thái yêu cầu
  updateReturnStatus: async (returnId, newStatus, accountId, exchanges = {}, actor = null) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [retData] = await connection.query('SELECT * FROM order_returns WHERE return_id = ? FOR UPDATE', [returnId]);
      if (retData.length === 0) throw new Error('Không tìm thấy yêu cầu trả hàng');
      if (actor?.role === 'staff') {
        const [[order]] = await connection.query('SELECT branch_id FROM orders WHERE order_id = ?', [retData[0].order_id]);
        if (Number(order.branch_id) !== Number(actor.branch_id)) throw Object.assign(new Error('Không được xử lý yêu cầu của chi nhánh khác'), { statusCode: 403 });
      }
      
      const currentStatus = retData[0].status;
      if (currentStatus === newStatus) { await connection.commit(); return true; }
      const transitions = { requested: ['approved', 'rejected'], approved: ['completed', 'rejected'], rejected: [], completed: [] };
      if (!transitions[currentStatus]?.includes(newStatus)) throw new Error('Không thể chuyển sang trạng thái này');

      // Cập nhật trạng thái
      await connection.query(
        'UPDATE order_returns SET status = ?, processed_by = ? WHERE return_id = ?',
        [newStatus, accountId, returnId]
      );

      // Nếu trạng thái chuyển sang completed (Đã nhận lại hàng)
      if (newStatus === 'completed' && currentStatus !== 'completed') {
        const orderId = retData[0].order_id;
        const [[order]] = await connection.query('SELECT * FROM orders WHERE order_id = ? FOR UPDATE', [orderId]);
        if (!order.branch_id) throw new Error('Đơn hàng chưa có chi nhánh nhận lại hàng');
        const [items] = await connection.query('SELECT * FROM order_return_items WHERE return_id = ?', [returnId]);
        
        let totalRefundAmount = 0;

        for (const item of items) {
          // Lấy variant_id và giá của item này
          const [oiData] = await connection.query('SELECT variant_id, unit_price FROM order_items WHERE order_item_id = ?', [item.order_item_id]);
          if (oiData.length > 0) {
            const variantId = oiData[0].variant_id;
            const price = oiData[0].unit_price;
            const paidItems = Math.max(0, Number(order.total_amount) - Number(order.shipping_fee || 0));
            totalRefundAmount += Math.round(price * item.quantity * Math.min(1, paidItems / Number(order.subtotal_amount || 1)));

            // Cộng lại kho (Giả sử kho mặc định là branch_id = 1)
            await connection.query(
              'INSERT INTO inventory (variant_id, branch_id, quantity) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)',
              [variantId, order.branch_id, item.quantity]
            );
            if (retData[0].return_type === 'exchange') {
              const replacementId = Number(exchanges[item.return_item_id] || item.exchange_variant_id);
              if (!Number.isSafeInteger(replacementId) || replacementId <= 0) throw new Error('Vui lòng chọn biến thể thay thế cho từng sản phẩm đổi');
              const [[replacement]] = await connection.query('SELECT v.price, v.is_active, p.is_active AS product_active, v.product_id FROM product_variants v JOIN products p ON p.product_id = v.product_id WHERE v.variant_id = ?', [replacementId]);
              const [[original]] = await connection.query('SELECT product_id FROM product_variants WHERE variant_id = ?', [variantId]);
              if (!replacement || !replacement.is_active || !replacement.product_active || replacement.product_id !== original.product_id || Number(replacement.price) !== Number(price)) throw new Error('Chỉ hỗ trợ đổi size/màu cùng sản phẩm và cùng đơn giá');
              const [[inventory]] = await connection.query('SELECT quantity FROM inventory WHERE variant_id = ? AND branch_id = ? FOR UPDATE', [replacementId, order.branch_id]);
              if (!inventory || Number(inventory.quantity) < Number(item.quantity)) throw new Error('Biến thể thay thế không đủ tồn kho tại chi nhánh');
              await connection.query('UPDATE inventory SET quantity = quantity - ? WHERE variant_id = ? AND branch_id = ?', [item.quantity, replacementId, order.branch_id]);
              await connection.query('UPDATE order_return_items SET exchange_variant_id = ? WHERE return_item_id = ?', [replacementId, item.return_item_id]);
            }
          }
        }

        // Tạo record hoàn tiền (payment_refunds)
        if (retData[0].return_type === 'return' && totalRefundAmount > 0) {
          // Lấy payment_id của đơn hàng này
          const [payment] = await connection.query("SELECT payment_id FROM payments WHERE order_id = ? AND payment_status = 'success' LIMIT 1", [orderId]);
          if (payment.length > 0) {
            await connection.query(
              'INSERT INTO payment_refunds (payment_id, amount, reason, status, processed_by) VALUES (?, ?, ?, ?, ?)',
              [payment[0].payment_id, totalRefundAmount, retData[0].reason, 'pending', accountId]
            );
          }
        }

        // Cập nhật trạng thái đơn hàng thành 'returned' nếu trả toàn bộ (Ở đây đơn giản hóa là cập nhật luôn trạng thái)
        const [[remaining]] = await connection.query("SELECT SUM(oi.quantity) - COALESCE((SELECT SUM(ri.quantity) FROM order_return_items ri JOIN order_returns r ON r.return_id = ri.return_id WHERE r.order_id = ? AND r.status = 'completed'),0) AS quantity FROM order_items oi WHERE oi.order_id = ?", [orderId, orderId]);
        if (retData[0].return_type === 'return' && Number(remaining.quantity) === 0) await connection.query('UPDATE orders SET order_status = ? WHERE order_id = ?', ['returned', orderId]);
        if (retData[0].return_type === 'return' && order.customer_id && Number(order.points_earned) > 0) {
          const [[returned]] = await connection.query("SELECT COALESCE(SUM(ri.quantity * oi.unit_price),0) AS amount FROM order_return_items ri JOIN order_returns r ON r.return_id = ri.return_id JOIN order_items oi ON oi.order_item_id = ri.order_item_id WHERE r.order_id = ? AND r.status = 'completed' AND r.return_type = 'return'", [orderId]);
          const netPaid = Math.max(0, Number(order.total_amount) - Number(order.shipping_fee || 0));
          const remainingValue = netPaid * Math.max(0, 1 - Number(returned.amount) / Number(order.subtotal_amount || 1));
          const remainingPoints = Math.min(Number(order.points_earned), Math.floor(remainingValue / 10000));
          await connection.query('UPDATE customers SET loyalty_points = GREATEST(0, loyalty_points - ?) WHERE customer_id = ?', [Number(order.points_earned) - remainingPoints, order.customer_id]);
          await connection.query('UPDATE orders SET points_earned = ? WHERE order_id = ?', [remainingPoints, orderId]);
        }

        // Thông báo cho khách hàng
        const [orderInfo] = await connection.query('SELECT customer_id, order_code FROM orders WHERE order_id = ?', [orderId]);
        if (orderInfo.length > 0 && orderInfo[0].customer_id) {
          await connection.query(
            'INSERT INTO notifications (customer_id, notif_type, content, related_order_id, is_read) VALUES (?, ?, ?, ?, 0)',
            [orderInfo[0].customer_id, 'return_completed', retData[0].return_type === 'exchange' ? `Đã hoàn tất đổi hàng cho đơn ${orderInfo[0].order_code}.` : `Đã nhận lại hàng cho đơn ${orderInfo[0].order_code}. Yêu cầu hoàn tiền đang chờ xử lý.`, orderId]
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
