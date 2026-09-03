const express = require('express');
const router = express.Router();
const AccountController = require('../controllers/accountController');
const { protect, authorize } = require('../middlewares/authMiddleware');

// TẤT CẢ các route trong file này đều yêu cầu Đăng nhập (protect) và có Quyền Admin (authorize('admin'))
router.use(protect);
router.use(authorize('admin'));

// Lấy danh sách tài khoản
router.get('/', AccountController.getAllAccounts);

// Tạo tài khoản mới
router.post('/', AccountController.createAccount);

// Cập nhật tài khoản (Họ tên, SĐT, Role)
router.put('/:id', AccountController.updateAccount);

// Cập nhật trạng thái (Khóa/Mở khóa)
router.patch('/:id/status', AccountController.toggleAccountStatus);

module.exports = router;
