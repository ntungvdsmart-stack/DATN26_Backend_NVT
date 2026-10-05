const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const pool = require('../config/database');

const StripeController = {
  // Tạo phiên thanh toán (Checkout Session)
  createCheckoutSession: async (orderId, orderCode, totalAmount, items, customerEmail, frontendUrl) => {
    try {
      const lineItems = [{
        price_data: {
          currency: 'vnd',
          product_data: {
            name: `Thanh toán đơn hàng #${orderCode}`,
          },
          unit_amount: Math.round(Number(totalAmount)),
        },
        quantity: 1,
      }];

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        customer_email: customerEmail || undefined,
        line_items: lineItems,
        mode: 'payment',
        success_url: `${frontendUrl}/order-tracking?code=${orderCode}&payment=success`,
        cancel_url: `${frontendUrl}/checkout?payment=cancel`,
        metadata: {
          orderId: orderId.toString()
        }
      });

      // Lưu tạm Session ID vào transaction_code để đối chiếu (kể cả khi chưa deploy webhook)
      await pool.query('UPDATE payments SET transaction_code = ? WHERE order_id = ?', [session.id, orderId]);

      // --- LOCAL DEV HACK --- 
      // Do localhost không nhận được Webhook từ Stripe, ta dùng Polling (kiểm tra liên tục) mỗi 3 giây 
      // để tự động cập nhật Database ngay khi khách hàng thanh toán xong. Khi Deploy lên server thật có Webhook, ta có thể xóa đoạn này.
      const pollInterval = setInterval(async () => {
        try {
          const checkSession = await stripe.checkout.sessions.retrieve(session.id);
          if (checkSession.payment_status === 'paid') {
            clearInterval(pollInterval);
            
            // 1. Cập nhật thanh toán thành công
            await pool.query(
              'UPDATE payments SET payment_status = ?, transaction_code = ? WHERE order_id = ?',
              ['success', checkSession.payment_intent, orderId]
            );
            
            // 2. Tự động xác nhận đơn hàng luôn
            await pool.query('UPDATE orders SET order_status = ? WHERE order_id = ?', ['confirmed', orderId]);

            // 3. Gửi thông báo
            await pool.query(
              'INSERT INTO notifications (notif_type, content, related_order_id, is_read) VALUES (?, ?, ?, 0)',
              ['system', `Khách hàng vừa thanh toán thành công qua Stripe cho đơn hàng #${orderCode}. Vui lòng xử lý!`, orderId]
            );
            
            // Lưu ý: Do chạy background nên không có req.io ở đây, nhưng nhân viên F5 lại sẽ thấy.
          }
        } catch (e) {
            // Lỗi hoặc hết hạn thì bỏ qua
            clearInterval(pollInterval);
        }
      }, 3000);
      
      // Tắt Polling sau 15 phút (giới hạn thời gian)
      setTimeout(() => clearInterval(pollInterval), 15 * 60 * 1000);
      // ----------------------

      return session.url;
    } catch (error) {
      console.error('Stripe create session error:', error);
      throw new Error('Lỗi tạo cổng thanh toán Stripe: ' + error.message);
    }
  },

  // Xử lý Webhook từ Stripe trả về
  handleWebhook: async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      if (!process.env.STRIPE_WEBHOOK_SECRET) {
        throw new Error('Thiếu cấu hình STRIPE_WEBHOOK_SECRET');
      }
      // Dùng req.body vì ở server.js ta đã map nó bằng express.raw()
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error(`Webhook Error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Xử lý khi thanh toán thành công
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const orderId = session.metadata.orderId;
      const paymentIntentId = session.payment_intent; // Lưu lại để dùng khi Refund

      try {
        await pool.query(
          'UPDATE payments SET payment_status = ?, transaction_code = ? WHERE order_id = ?',
          ['success', paymentIntentId, orderId]
        );
        console.log(`✅ Thanh toán thành công cho OrderID: ${orderId}`);
      } catch (dbErr) {
        console.error('Lỗi cập nhật CSDL khi thanh toán thành công:', dbErr);
      }
    }

    res.json({ received: true });
  },

  // Tự động Hoàn tiền (Refund)
  refundPayment: async (paymentIntentId, amount) => {
    try {
      const refund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: amount // Nếu trống, Stripe tự động hoàn toàn bộ số tiền
      });
      return refund;
    } catch (error) {
      console.error('Stripe Refund error:', error);
      throw new Error('Lỗi hoàn tiền qua Stripe: ' + error.message);
    }
  },

  // Phương thức thay thế Webhook khi chạy Localhost
  verifyPayment: async (req, res) => {
    try {
      const { orderCode } = req.body;
      
      const [orders] = await pool.query(`
        SELECT o.order_id, p.transaction_code, p.payment_status 
        FROM orders o 
        JOIN payments p ON o.order_id = p.order_id 
        WHERE o.order_code = ?
      `, [orderCode]);

      if (orders.length === 0) return res.status(404).json({ success: false, message: 'Đơn hàng không tồn tại' });
      
      const order = orders[0];
      if (order.payment_status === 'success') {
        return res.json({ success: true, message: 'Đã thanh toán' });
      }

      // transaction_code lúc này đang chứa Session ID của Stripe
      const sessionId = order.transaction_code;
      if (!sessionId || !sessionId.startsWith('cs_')) {
        return res.json({ success: false, message: 'Không tìm thấy phiên giao dịch' });
      }

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === 'paid') {
        const paymentIntentId = session.payment_intent;
        await pool.query(
          'UPDATE payments SET payment_status = ?, transaction_code = ? WHERE order_id = ?',
          ['success', paymentIntentId, order.order_id]
        );
        
        // Thông báo cho nhân viên/admin
        await pool.query(
          'INSERT INTO notifications (notif_type, content, related_order_id, is_read) VALUES (?, ?, ?, 0)',
          ['system', `Khách hàng vừa thanh toán thành công qua Stripe cho đơn hàng ${orderCode}. Vui lòng xử lý!`, order.order_id]
        );

        if (req.io) {
            req.io.emit('new_notification', {
                notif_type: 'system',
                content: `Khách hàng vừa thanh toán thành công qua Stripe cho đơn hàng ${orderCode}. Vui lòng xử lý!`,
                created_at: new Date()
            });
        }

        return res.json({ success: true, message: 'Xác nhận thanh toán thành công' });
      }

      return res.json({ success: false, message: 'Giao dịch chưa hoàn tất' });
    } catch (error) {
      console.error('Lỗi Verify Payment:', error);
      res.status(500).json({ success: false, message: 'Lỗi kiểm tra giao dịch' });
    }
  }
};

module.exports = StripeController;
