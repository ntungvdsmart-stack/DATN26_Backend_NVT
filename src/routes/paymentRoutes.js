const router = require('express').Router();
const pool = require('../config/database');
const GatewayService = require('../services/gatewayService');
const OrderService = require('../services/orderService');
const { protect, authorize } = require('../middlewares/authMiddleware');
router.get('/refunds', protect, authorize('admin'), async (req, res, next) => {
    try {
        const page = Number(req.query.page || 1), limit = Number(req.query.limit || 20);
        if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return res.status(400).json({ success: false, message: 'Trang hoặc số dòng không hợp lệ' });
        const [[count]] = await pool.query('SELECT COUNT(*) AS total FROM payment_refunds');
        const totalPages = Math.max(1, Math.ceil(Number(count.total) / limit));
        const current = Math.min(page, totalPages);
        const [items] = await pool.query('SELECT r.*, o.order_code, p.payment_method, c.full_name AS customer_name FROM payment_refunds r JOIN payments p ON p.payment_id = r.payment_id JOIN orders o ON o.order_id = p.order_id LEFT JOIN customers c ON c.customer_id = o.customer_id ORDER BY r.created_at DESC, r.refund_id DESC LIMIT ? OFFSET ?', [limit, (current - 1) * limit]);
        res.json({ success: true, data: items, pagination: { page: current, limit, total: Number(count.total), totalPages } });
    } catch (error) { next(error); }
});
router.put('/refunds/:id/complete', protect, authorize('admin'), async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [[refund]] = await connection.query('SELECT r.*, p.transaction_code, p.payment_method, p.amount AS paid_amount FROM payment_refunds r JOIN payments p ON p.payment_id = r.payment_id WHERE r.refund_id = ? FOR UPDATE', [req.params.id]);
        if (!refund) throw Object.assign(new Error('Không tìm thấy yêu cầu hoàn tiền'), { statusCode: 404 });
        if (refund.status === 'completed') { await connection.commit(); return res.json({ success: true }); }
        if (refund.status !== 'pending') throw Object.assign(new Error('Yêu cầu không ở trạng thái chờ'), { statusCode: 400 });
        const [[paid]] = await connection.query("SELECT COALESCE(SUM(amount),0) AS amount FROM payment_refunds WHERE payment_id = ? AND status = 'completed'", [refund.payment_id]);
        if (Number(paid.amount) + Number(refund.amount) > Number(refund.paid_amount)) throw Object.assign(new Error('Tổng tiền hoàn vượt quá số đã thanh toán'), { statusCode: 400 });
        if (refund.payment_method === 'stripe') {
            if (!refund.transaction_code?.startsWith('pi_')) throw Object.assign(new Error('Thiếu mã thanh toán thẻ'), { statusCode: 400 });
            const result = await require('../services/stripeService').refund(refund.transaction_code, refund.amount, `refund-${refund.refund_id}`);
            if (result.status !== 'succeeded') throw Object.assign(new Error('Cổng thanh toán chưa xác nhận hoàn tiền thành công'), { statusCode: 409 });
        } else if (req.body.confirmed !== true) throw Object.assign(new Error('Cần xác nhận đã hoàn tiền cho khách qua phương thức gốc'), { statusCode: 400 });
        await connection.query("UPDATE payment_refunds SET status = 'completed', processed_by = ? WHERE refund_id = ?", [req.user.id, refund.refund_id]);
        if (Number(paid.amount) + Number(refund.amount) >= Number(refund.paid_amount)) await connection.query("UPDATE payments SET payment_status = 'refunded' WHERE payment_id = ?", [refund.payment_id]);
        await connection.query('INSERT INTO activity_logs (account_id, action, target_table, target_id, description) VALUES (?, ?, ?, ?, ?)', [req.user.id, 'COMPLETE_REFUND', 'payment_refunds', refund.refund_id, `Hoàn tiền ${refund.amount} đồng`]);
        await connection.commit();
        res.json({ success: true });
    } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});
router.get('/methods', (req, res) => res.json({ success: true, data: GatewayService.available() }));
const receive = async (method, orderCode, amount, transactionId) => {
    const [[order]] = await pool.query('SELECT o.order_id, o.total_amount, p.payment_method, p.payment_status FROM orders o JOIN payments p ON p.order_id = o.order_id WHERE o.order_code = ?', [orderCode]);
    if (!order) return '01';
    if (order.payment_method !== method || !Number.isFinite(amount) || Math.round(Number(order.total_amount)) !== amount) return '04';
    if (order.payment_status === 'success' || order.payment_status === 'refunded') return '02';
    await OrderService.markOrderPaid(order.order_id, String(transactionId));
    return '00';
};
router.get('/vnpay/ipn', async (req, res) => {
    try {
        if (!GatewayService.verifyVnpay(req.query)) return res.json({ RspCode: '97', Message: 'Invalid signature' });
        if (req.query.vnp_ResponseCode !== '00' || req.query.vnp_TransactionStatus !== '00') return res.json({ RspCode: '00', Message: 'Acknowledged' });
        const code = await receive('vnpay', req.query.vnp_TxnRef, Number(req.query.vnp_Amount) / 100, req.query.vnp_TransactionNo);
        res.json({ RspCode: code, Message: code === '00' ? 'Confirm Success' : 'Order validation failed' });
    } catch (error) { console.error('VNPay IPN:', error.message); res.json({ RspCode: '99', Message: 'Retry later' }); }
});
router.post('/momo/ipn', async (req, res) => {
    try {
        if (!GatewayService.verifyMomo(req.body)) return res.status(400).json({ message: 'Invalid signature' });
        if (Number(req.body.resultCode) === 0) {
            const code = await receive('momo', req.body.orderId, Number(req.body.amount), req.body.transId);
            if (!['00', '02'].includes(code)) return res.status(400).json({ message: 'Order validation failed' });
        }
        res.status(204).end();
    } catch (error) { console.error('MoMo IPN:', error.message); res.status(500).json({ message: 'Retry later' }); }
});
module.exports = router;
