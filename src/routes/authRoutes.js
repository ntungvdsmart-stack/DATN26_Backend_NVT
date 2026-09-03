const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/authController');

// Đăng ký tài khoản khách hàng
router.post('/register', AuthController.registerCustomer);

// Đăng nhập thống nhất (Customer / Staff / Admin đều dùng chung)
router.post('/login', AuthController.login);

module.exports = router;
