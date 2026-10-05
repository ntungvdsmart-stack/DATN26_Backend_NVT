const express = require('express');
const router = express.Router();
const AccountController = require('../controllers/accountController');
const { protect, authorize } = require('../middlewares/authMiddleware');

// TẤT CẢ các route dưới đây yêu cầu Đăng nhập (protect)
router.use(protect);

// Route cho bản thân (staff/admin)
router.get('/me', AccountController.getMe);
router.put('/me', AccountController.updateMe);

// Các route quản trị cần quyền Admin
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
