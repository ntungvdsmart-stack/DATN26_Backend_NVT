const validateDeleteIds = require('../middlewares/validateDeleteIds');
const express = require('express');
const router = express.Router();
const ProductController = require('../controllers/productController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');

// Middleware helpers
const staffOrAdmin = [protect, authorize('admin', 'staff')];
router.get('/categories', async (req, res, next) => {
    try {
        const [data] = await require('../config/database').query('SELECT category_id, category_name, parent_id FROM categories ORDER BY sort_order, category_id');
        res.json({ success: true, data });
    } catch (error) { next(error); }
});
router.get('/featured-categories', async (req, res, next) => {
    try {
        const [data] = await require('../config/database').query('SELECT category_id, category_name, image_url, display_order FROM categories WHERE is_featured = 1 ORDER BY display_order, category_id');
        res.json({ success: true, data });
    } catch (error) { next(error); }
});
router.use((req, res, next) => {
    if (!['POST','PUT'].includes(req.method)) return next();
    const match = req.path.match(/^\/attributes\/(categories|brands|sizes|colors|materials)(?:\/[^/]+)?$/);
    if (!match) return next();
    const fields = { categories: ['category_name',100], brands: ['brand_name',100], sizes: ['size_value',20], colors: ['color_name',50], materials: ['material_name',100] };
    const [key, max] = fields[match[1]];
    if (typeof req.body[key] !== 'string' || !req.body[key].trim() || req.body[key].length > max) return res.status(400).json({ success: false, message: `Tên bắt buộc và tối đa ${max} ký tự` });
    req.body[key] = req.body[key].trim();
    if (match[1] === 'colors' && req.body.hex_code && !/^#[a-fA-F0-9]{6}$/.test(req.body.hex_code)) return res.status(400).json({ success: false, message: 'Mã màu phải có dạng #RRGGBB' });
    next();
});

// === Attributes (cho Form dropdowns, phải đặt TRƯỚC /:id) ===
router.get('/attributes/all', ...staffOrAdmin, ProductController.getFormAttributes);
router.post('/attributes/categories', ...staffOrAdmin, ProductController.createCategory);
router.put('/attributes/categories/:id', ...staffOrAdmin, ProductController.updateCategory);
router.delete('/attributes/categories/:id', ...staffOrAdmin, validateDeleteIds, ProductController.deleteCategory);

router.post('/attributes/brands', ...staffOrAdmin, ProductController.createBrand);
router.put('/attributes/brands/:id', ...staffOrAdmin, ProductController.updateBrand);
router.delete('/attributes/brands/:id', ...staffOrAdmin, validateDeleteIds, ProductController.deleteBrand);

router.post('/attributes/sizes', ...staffOrAdmin, ProductController.createSize);
router.put('/attributes/sizes/:id', ...staffOrAdmin, ProductController.updateSize);
router.delete('/attributes/sizes/:id', ...staffOrAdmin, validateDeleteIds, ProductController.deleteSize);

router.post('/attributes/colors', ...staffOrAdmin, ProductController.createColor);
router.put('/attributes/colors/:id', ...staffOrAdmin, ProductController.updateColor);
router.delete('/attributes/colors/:id', ...staffOrAdmin, validateDeleteIds, ProductController.deleteColor);

router.post('/attributes/materials', ...staffOrAdmin, ProductController.createMaterial);
router.put('/attributes/materials/:id', ...staffOrAdmin, ProductController.updateMaterial);
router.delete('/attributes/materials/:id', ...staffOrAdmin, validateDeleteIds, ProductController.deleteMaterial);

// === Upload ảnh từ máy local (multer) ===
const multerUpload = upload.array('images', 10);
const handleCloudinaryUpload = (req, res, next) => {
    multerUpload(req, res, (err) => {
        if (err) {
            return next(err);
        }
        next();
    });
};
router.post('/upload-images', ...staffOrAdmin, handleCloudinaryUpload, ProductController.uploadImages);

// === Upload ảnh từ URL web (tải thẳng lên Cloudinary) ===
router.post('/upload-image-url', ...staffOrAdmin, ProductController.uploadImageUrl);

// === Quản lý sản phẩm (Admin / Staff) — đặt TRƯỚC public /:id ===
router.get('/admin/all', ...staffOrAdmin, ProductController.getAllProducts);
router.get('/admin/:id', ...staffOrAdmin, ProductController.getProductDetails);

router.post('/',      ...staffOrAdmin, ProductController.createProduct);
router.put('/:id',    ...staffOrAdmin, ProductController.updateProduct);
router.delete('/:id', ...staffOrAdmin, validateDeleteIds, ProductController.deleteProduct);

// Xóa riêng 1 biến thể
router.delete('/:id/variants/:variantId', ...staffOrAdmin, validateDeleteIds, ProductController.deleteVariant);

// Bật / Tắt trạng thái bán
router.patch('/:id/status', ...staffOrAdmin, ProductController.toggleProductStatus);

// === Public (Storefront) — ĐẶT CUỐI CÙNG vì /:id sẽ catch-all ===
router.get('/', ProductController.getPublicProducts);
router.get('/search-suggestions', async (req, res, next) => {
    try {
        const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        if (!q || q.length > 100) return res.status(400).json({ success: false, message: 'Từ khóa cần từ 1 đến 100 ký tự' });
        const pool = require('../config/database');
        // Parameter binding plus escaping LIKE wildcards keeps suggestions literal and bounded.
        const pattern = `%${q.replace(/[!%_]/g, '!$&')}%`;
        const [products] = await pool.query(`
            SELECT p.product_id, p.product_name, p.base_price, c.category_name, b.brand_name,
                (SELECT image_url FROM product_images pi WHERE pi.product_id = p.product_id ORDER BY pi.is_primary DESC, pi.sort_order, pi.image_id LIMIT 1) AS primary_image
            FROM products p
            LEFT JOIN categories c ON c.category_id = p.category_id
            LEFT JOIN categories pc ON pc.category_id = c.parent_id
            LEFT JOIN brands b ON b.brand_id = p.brand_id
            WHERE p.is_active = 1 AND (p.product_name LIKE ? ESCAPE '!' OR c.category_name LIKE ? ESCAPE '!' OR pc.category_name LIKE ? ESCAPE '!' OR b.brand_name LIKE ? ESCAPE '!')
            ORDER BY p.product_name, p.product_id LIMIT 6
        `, [pattern, pattern, pattern, pattern]);
        const keywords = [...new Set(products.flatMap(p => [p.category_name, p.brand_name]).filter(Boolean))].slice(0, 5);
        res.json({ success: true, data: { products, keywords } });
    } catch (error) { next(error); }
});
router.get('/:id', ProductController.getPublicProductDetails);

module.exports = router;
