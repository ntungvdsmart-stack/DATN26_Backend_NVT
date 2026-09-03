const ProductModel = require('../models/productModel');
const { sendResponse } = require('../utils/responseHelper');

const ProductController = {
    // ── Lấy danh sách thuộc tính Form (Categories, Brands, Colors...) ──
    getFormAttributes: async (req, res, next) => {
        try {
            const pool = require('../config/database');
            const [[categories], [brands], [sizes], [colors], [materials]] = await Promise.all([
                pool.query(`
                    SELECT c.category_id, c.category_name, p.category_name as parent_name
                    FROM categories c LEFT JOIN categories p ON c.parent_id = p.category_id
                    ORDER BY COALESCE(c.parent_id, c.category_id), c.sort_order
                `),
                pool.query('SELECT brand_id, brand_name FROM brands ORDER BY brand_name'),
                pool.query('SELECT size_id, size_value FROM sizes ORDER BY size_id'),
                pool.query('SELECT color_id, color_name, hex_code FROM colors ORDER BY color_name'),
                pool.query('SELECT material_id, material_name FROM materials ORDER BY material_name'),
            ]);
            sendResponse(res, 200, true, 'OK', { categories, brands, sizes, colors, materials });
        } catch (error) { next(error); }
    },

    // ── Upload ảnh local → trả về URL public ──
    uploadImages: async (req, res, next) => {
        try {
            if (!req.files || req.files.length === 0)
                return sendResponse(res, 400, false, 'Không có file nào được tải lên');

            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const uploaded = req.files.map((file, i) => ({
                url: `${baseUrl}/uploads/products/${file.filename}`,
                filename: file.filename,
                originalName: file.originalname,
                size: file.size,
                is_primary: i === 0,
            }));
            sendResponse(res, 200, true, `Tải ${uploaded.length} ảnh thành công`, uploaded);
        } catch (error) { next(error); }
    },

    // ── Danh sách sản phẩm (Admin) ──
    getAllProducts: async (req, res, next) => {
        try {
            const products = await ProductModel.getAll();
            sendResponse(res, 200, true, 'OK', products);
        } catch (error) { next(error); }
    },

    // ── Chi tiết sản phẩm (Admin) ──
    getProductDetails: async (req, res, next) => {
        try {
            const product = await ProductModel.getById(req.params.id);
            if (!product) return sendResponse(res, 404, false, 'Không tìm thấy sản phẩm');
            sendResponse(res, 200, true, 'OK', product);
        } catch (error) { next(error); }
    },

    // ── Danh sách sản phẩm (Public Storefront) ──
    getPublicProducts: async (req, res, next) => {
        try {
            const products = await ProductModel.getPublicProducts();
            sendResponse(res, 200, true, 'OK', products);
        } catch (error) { next(error); }
    },

    // ── Chi tiết sản phẩm (Public Storefront) ──
    getPublicProductDetails: async (req, res, next) => {
        try {
            const product = await ProductModel.getPublicProductDetails(req.params.id);
            if (!product) return sendResponse(res, 404, false, 'Không tìm thấy sản phẩm (Hoặc đã ngừng bán)');
            sendResponse(res, 200, true, 'OK', product);
        } catch (error) { next(error); }
    },

    // ── Tạo sản phẩm mới ──
    createProduct: async (req, res, next) => {
        try {
            const { product, variants, images } = req.body;
            if (!product?.product_name || !product?.category_id)
                return sendResponse(res, 400, false, 'Tên sản phẩm và Danh mục là bắt buộc');
            if (!variants || variants.length === 0)
                return sendResponse(res, 400, false, 'Phải có ít nhất 1 biến thể');

            const productId = await ProductModel.create(product, variants, images, req.user.id);
            sendResponse(res, 201, true, 'Tạo sản phẩm thành công', { product_id: productId });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY')
                return sendResponse(res, 400, false, 'Mã SKU đã tồn tại. Kiểm tra lại!');
            next(error);
        }
    },

    // ── Cập nhật sản phẩm ──
    updateProduct: async (req, res, next) => {
        try {
            const { id } = req.params;
            const { product, variants, images } = req.body;
            if (!product?.product_name || !product?.category_id)
                return sendResponse(res, 400, false, 'Tên sản phẩm và Danh mục là bắt buộc');

            await ProductModel.update(id, product, variants, images, req.user.id);
            sendResponse(res, 200, true, 'Cập nhật sản phẩm thành công');
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY')
                return sendResponse(res, 400, false, 'Mã SKU đã tồn tại. Kiểm tra lại!');
            if (error.statusCode === 404)
                return sendResponse(res, 404, false, error.message);
            next(error);
        }
    },

    // ── Xóa sản phẩm ──
    deleteProduct: async (req, res, next) => {
        try {
            await ProductModel.delete(req.params.id, req.user.id);
            sendResponse(res, 200, true, 'Xóa sản phẩm thành công');
        } catch (error) {
            if (error.statusCode === 404)
                return sendResponse(res, 404, false, error.message);
            next(error);
        }
    },

    // ── Xóa 1 biến thể ──
    deleteVariant: async (req, res, next) => {
        try {
            const { id, variantId } = req.params;
            const deleted = await ProductModel.deleteVariant(variantId, id);
            if (!deleted)
                return sendResponse(res, 404, false, 'Không tìm thấy biến thể này');
            sendResponse(res, 200, true, 'Xóa biến thể thành công');
        } catch (error) { next(error); }
    },

    // ── Bật/Tắt trạng thái ──
    toggleProductStatus: async (req, res, next) => {
        try {
            const { is_active } = req.body;
            if (is_active === undefined)
                return sendResponse(res, 400, false, 'Thiếu is_active');
            await ProductModel.toggleStatus(req.params.id, is_active ? 1 : 0);
            sendResponse(res, 200, true, `Đã ${is_active ? 'mở bán' : 'ngừng bán'} sản phẩm`);
        } catch (error) { next(error); }
    },
};

module.exports = ProductController;
