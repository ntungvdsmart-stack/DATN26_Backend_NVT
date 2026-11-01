const router = require('express').Router();
const pool = require('../config/database');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { sendResponse } = require('../utils/responseHelper');

router.get('/', protect, authorize('admin'), async (req, res, next) => {
    try {
        const page = Math.min(1000000, Math.max(1, Math.floor(Number(req.query.page) || 1)));
        const limit = 30;
        const search = String(req.query.search || '').trim().slice(0, 150);
        const where = search ? 'WHERE l.action LIKE ? OR l.description LIKE ? OR a.full_name LIKE ? OR c.full_name LIKE ?' : '';
        const params = search ? Array(4).fill(`%${search}%`) : [];
        const joins = 'FROM activity_logs l LEFT JOIN accounts a ON a.account_id = l.account_id LEFT JOIN customers c ON c.customer_id = l.customer_id';
        const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${joins} ${where}`, params);
        const [items] = await pool.query(`SELECT l.*, COALESCE(a.full_name, c.full_name) AS actor_name ${joins} ${where} ORDER BY l.created_at DESC, l.log_id DESC LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]);
        sendResponse(res, 200, true, 'OK', { items, total, page, limit });
    } catch (error) { next(error); }
});
module.exports = router;
