const express = require('express');
const router = express.Router();
const ProductController = require('../controllers/productController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');

const staffOrAdmin = protect, role = authorize('admin', 'staff');

// ── Attributes (cho Form dropdowns) ──────────────────────────────
router.get('/attributes/all', staffOrAdmin, role, ProductController.getFormAttributes);

// ── Upload ảnh từ máy local (multer) ─────────────────────────────
// Nhận tối đa 10 ảnh cùng lúc, field name = "images"
router.post('/upload-images', staffOrAdmin, role,
    upload.array('images', 10),
    ProductController.uploadImages
);

// ── Public (Storefront) ───────────────────────────────────────────
router.get('/', ProductController.getPublicProducts);
router.get('/:id', ProductController.getPublicProductDetails);

// ── Quản lý sản phẩm (Admin / Staff) ─────────────────────────────
router.get('/admin/all', staffOrAdmin, role, ProductController.getAllProducts);
router.get('/admin/:id', staffOrAdmin, role, ProductController.getProductDetails);

router.post('/',      staffOrAdmin, role, ProductController.createProduct);
router.put('/:id',    staffOrAdmin, role, ProductController.updateProduct);
router.delete('/:id', staffOrAdmin, role, ProductController.deleteProduct);

// Xóa riêng 1 biến thể
router.delete('/:id/variants/:variantId', staffOrAdmin, role, ProductController.deleteVariant);

// Bật / Tắt trạng thái bán
router.patch('/:id/status', staffOrAdmin, role, ProductController.toggleProductStatus);

module.exports = router;
