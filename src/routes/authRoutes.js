const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');
router.get('/me', protect, async (req, res, next) => {
    try {
        const pool = require('../config/database');
        const isCustomer = req.user.role === 'customer';
        const [[user]] = await pool.query(isCustomer ? 'SELECT customer_id AS id, full_name, phone, email FROM customers WHERE customer_id = ?' : 'SELECT account_id AS id, full_name, phone, email, role_id, branch_id, username FROM accounts WHERE account_id = ?', [req.user.id]);
        res.json({ success: true, data: { ...user, role: req.user.role, permissions: req.user.permissions || [] } });
    } catch (error) { next(error); }
});

// Đăng ký tài khoản khách hàng
router.post('/register', AuthController.registerCustomer);

// Đăng nhập thống nhất (Customer / Staff / Admin đều dùng chung)
router.post('/login', AuthController.login);
router.post('/forgot-password', require('../controllers/passwordController').forgot);
router.post('/verify-password-otp', require('../controllers/passwordController').verify);
router.post('/reset-password', require('../controllers/passwordController').reset);

module.exports = router;
