const ProductModel = require('../models/productModel');
const CategoryModel = require('../models/categoryModel');
const BrandModel = require('../models/brandModel');
const { sendResponse } = require('../utils/responseHelper');
const cloudinary = require('cloudinary').v2;

const extractPublicId = (url) => {
    if (!url || !url.includes('cloudinary.com')) return null;
    const parts = url.split('/upload/');
    if (parts.length < 2) return null;
    let path = parts[1];
    if (path.match(/^v\d+\//)) path = path.replace(/^v\d+\//, '');
    const lastDot = path.lastIndexOf('.');
    if (lastDot !== -1) path = path.substring(0, lastDot);
    return path;
};

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
                pool.query(`SELECT size_id, size_value FROM sizes 
                    ORDER BY CASE 
                        WHEN size_value LIKE 'S %' OR size_value = 'S' THEN 1
                        WHEN size_value LIKE 'M %' OR size_value = 'M' THEN 2
                        WHEN size_value LIKE 'L %' OR size_value = 'L' THEN 3
                        WHEN size_value LIKE 'XL %' OR size_value = 'XL' THEN 4
                        WHEN size_value LIKE 'XXL %' OR size_value = 'XXL' THEN 5
                        WHEN size_value LIKE 'XXXL %' OR size_value = 'XXXL' THEN 6
                        ELSE 99 END, size_id`),
                pool.query('SELECT color_id, color_name, hex_code FROM colors ORDER BY color_name'),
                pool.query('SELECT material_id, material_name FROM materials ORDER BY material_name'),
            ]);
            sendResponse(res, 200, true, 'Lấy danh sách thuộc tính thành công', {
                categories, brands, sizes, colors, materials
            });
        } catch (error) {
            next(error);
        }
    },

    createCategory: async (req, res, next) => {
        try {
            const { category_name, parent_id } = req.body;
            if (!category_name) {
                return sendResponse(res, 400, false, 'Tên danh mục là bắt buộc');
            }
            const category_id = await CategoryModel.create(category_name, parent_id);
            sendResponse(res, 201, true, 'Tạo danh mục thành công', { category_id, category_name, parent_id });
        } catch (error) {
            next(error);
        }
    },

    updateCategory: async (req, res, next) => {
        try {
            const { id } = req.params;
            const { category_name, parent_id } = req.body;
            if (!category_name) {
                return sendResponse(res, 400, false, 'Tên danh mục là bắt buộc');
            }
            await CategoryModel.update(id, category_name, parent_id);
            sendResponse(res, 200, true, 'Cập nhật danh mục thành công');
        } catch (error) {
            next(error);
        }
    },

    deleteCategory: async (req, res, next) => {
        try {
            const { id } = req.params;
            await CategoryModel.delete(id);
            sendResponse(res, 200, true, 'Xóa danh mục thành công');
        } catch (error) {
            if (error.code === 'ER_ROW_IS_REFERENCED_2') {
                return sendResponse(res, 400, false, 'Không thể xóa danh mục vì đang có sản phẩm thuộc danh mục này');
            }
            next(error);
        }
    },

    createBrand: async (req, res, next) => {
        try {
            const { brand_name } = req.body;
            if (!brand_name) {
                return sendResponse(res, 400, false, 'Tên thương hiệu là bắt buộc');
            }
            const brand_id = await BrandModel.create(brand_name);
            sendResponse(res, 201, true, 'Tạo thương hiệu thành công', { brand_id, brand_name });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                return sendResponse(res, 400, false, 'Thương hiệu này đã tồn tại');
            }
            next(error);
        }
    },

    updateBrand: async (req, res, next) => {
        try {
            const { id } = req.params;
            const { brand_name } = req.body;
            if (!brand_name) {
                return sendResponse(res, 400, false, 'Tên thương hiệu là bắt buộc');
            }
            await BrandModel.update(id, brand_name);
            sendResponse(res, 200, true, 'Cập nhật thương hiệu thành công');
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                return sendResponse(res, 400, false, 'Thương hiệu này đã tồn tại');
            }
            next(error);
        }
    },

    deleteBrand: async (req, res, next) => {
        try {
            const { id } = req.params;
            await BrandModel.delete(id);
            sendResponse(res, 200, true, 'Xóa thương hiệu thành công');
        } catch (error) {
            if (error.code === 'ER_ROW_IS_REFERENCED_2') {
                return sendResponse(res, 400, false, 'Không thể xóa thương hiệu vì đang có sản phẩm thuộc thương hiệu này');
            }
            next(error);
        }
    },

    createSize: async (req, res, next) => {
        try {
            const { size_value } = req.body;
            if (!size_value) {
                return sendResponse(res, 400, false, 'Giá trị Size là bắt buộc');
            }
            const SizeModel = require('../models/sizeModel');
            const size_id = await SizeModel.create(size_value);
            sendResponse(res, 201, true, 'Tạo Size thành công', { size_id, size_value });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                return sendResponse(res, 400, false, 'Size này đã tồn tại');
            }
            next(error);
        }
    },

    updateSize: async (req, res, next) => {
        try {
            const { id } = req.params;
            const { size_value } = req.body;
            if (!size_value) {
                return sendResponse(res, 400, false, 'Giá trị Size là bắt buộc');
            }
            const SizeModel = require('../models/sizeModel');
            await SizeModel.update(id, size_value);
            sendResponse(res, 200, true, 'Cập nhật Size thành công');
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                return sendResponse(res, 400, false, 'Size này đã tồn tại');
            }
            next(error);
        }
    },

    deleteSize: async (req, res, next) => {
        try {
            const { id } = req.params;
            const SizeModel = require('../models/sizeModel');
            await SizeModel.delete(id);
            sendResponse(res, 200, true, 'Xóa Size thành công');
        } catch (error) {
            if (error.code === 'ER_ROW_IS_REFERENCED_2') {
                return sendResponse(res, 400, false, 'Không thể xóa Size vì đang có sản phẩm dùng Size này');
            }
            next(error);
        }
    },

    // === QUẢN LÝ MÀU SẮC ===
    createColor: async (req, res, next) => {
        try {
            const { color_name, hex_code } = req.body;
            if (!color_name) return sendResponse(res, 400, false, 'Tên màu là bắt buộc');
            const ColorModel = require('../models/colorModel');
            const color_id = await ColorModel.create(color_name, hex_code);
            sendResponse(res, 201, true, 'Tạo màu thành công', { color_id, color_name, hex_code });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') return sendResponse(res, 400, false, 'Màu này đã tồn tại');
            next(error);
        }
    },
    updateColor: async (req, res, next) => {
        try {
            const { id } = req.params;
            const { color_name, hex_code } = req.body;
            if (!color_name) return sendResponse(res, 400, false, 'Tên màu là bắt buộc');
            const ColorModel = require('../models/colorModel');
            await ColorModel.update(id, color_name, hex_code);
            sendResponse(res, 200, true, 'Cập nhật màu thành công');
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') return sendResponse(res, 400, false, 'Màu này đã tồn tại');
            next(error);
        }
    },
    deleteColor: async (req, res, next) => {
        try {
            const { id } = req.params;
            const ColorModel = require('../models/colorModel');
            await ColorModel.delete(id);
            sendResponse(res, 200, true, 'Xóa màu thành công');
        } catch (error) {
            if (error.code === 'ER_ROW_IS_REFERENCED_2') return sendResponse(res, 400, false, 'Không thể xóa màu vì đang có sản phẩm dùng màu này');
            next(error);
        }
    },

    // === QUẢN LÝ CHẤT LIỆU ===
    createMaterial: async (req, res, next) => {
        try {
            const { material_name } = req.body;
            if (!material_name) return sendResponse(res, 400, false, 'Tên chất liệu là bắt buộc');
            const MaterialModel = require('../models/materialModel');
            const material_id = await MaterialModel.create(material_name);
            sendResponse(res, 201, true, 'Tạo chất liệu thành công', { material_id, material_name });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') return sendResponse(res, 400, false, 'Chất liệu này đã tồn tại');
            next(error);
        }
    },
    updateMaterial: async (req, res, next) => {
        try {
            const { id } = req.params;
            const { material_name } = req.body;
            if (!material_name) return sendResponse(res, 400, false, 'Tên chất liệu là bắt buộc');
            const MaterialModel = require('../models/materialModel');
            await MaterialModel.update(id, material_name);
            sendResponse(res, 200, true, 'Cập nhật chất liệu thành công');
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') return sendResponse(res, 400, false, 'Chất liệu này đã tồn tại');
            next(error);
        }
    },
    deleteMaterial: async (req, res, next) => {
        try {
            const { id } = req.params;
            const MaterialModel = require('../models/materialModel');
            await MaterialModel.delete(id);
            sendResponse(res, 200, true, 'Xóa chất liệu thành công');
        } catch (error) {
            if (error.code === 'ER_ROW_IS_REFERENCED_2') return sendResponse(res, 400, false, 'Không thể xóa chất liệu vì đang có sản phẩm dùng chất liệu này');
            next(error);
        }
    },

    // === QUẢN LÝ SẢN PHẨM ===
    // ── Upload ảnh Cloudinary → trả về URL public ──
    uploadImages: async (req, res, next) => {
        try {
            if (!req.files || req.files.length === 0)
                return sendResponse(res, 400, false, 'Không có file nào được tải lên');

            const uploaded = req.files.map((file, i) => ({
                url: file.path, // Cloudinary URL
                filename: file.filename, // Cloudinary public_id
                originalName: file.originalname,
                size: file.size,
                is_primary: i === 0,
            }));
            sendResponse(res, 200, true, `Tải ${uploaded.length} ảnh thành công`, uploaded);
        } catch (error) { next(error); }
    },

    // ── Upload ảnh từ URL web thẳng lên Cloudinary ──
    uploadImageUrl: async (req, res, next) => {
        try {
            const { url } = req.body;
            if (!url) return sendResponse(res, 400, false, 'Thiếu URL ảnh');

            const result = await cloudinary.uploader.upload(url, {
                folder: 'fashionOS/products',
                public_id: `product-${Date.now()}-${Math.round(Math.random() * 1e6)}`
            });

            const uploaded = [{
                url: result.secure_url,
                filename: result.public_id,
                originalName: 'url-image',
                size: result.bytes,
                is_primary: true
            }];
            sendResponse(res, 200, true, 'Tải ảnh từ URL thành công', uploaded);
        } catch (error) {
            console.error('Lỗi upload từ URL:', error.message);
            // Giả lập trả về ảnh lỗi Cloudinary
            const uploaded = [{
                url: 'https://placehold.co/400x500/f3f4f6/9ca3af?text=Lỗi+Tài+Khoản',
                filename: `fallback-${Date.now()}`,
                originalName: 'url-image-error',
                size: 0,
                is_primary: true
            }];
            sendResponse(res, 200, true, 'Tải ảnh (dùng dự phòng) thành công', uploaded);
        }
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

            const productId = await ProductModel.create(product, variants, images, req.user.id, req.user.branch_id);
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

            // Lấy dữ liệu cũ để so sánh ảnh
            const oldProduct = await ProductModel.getById(id);

            await ProductModel.update(id, product, variants, images, req.user.id, req.user.branch_id);

            // Dọn dẹp ảnh cũ trên Cloudinary nếu bị xóa
            if (oldProduct && oldProduct.images && images) {
                const newImageUrls = images.map(img => img.url);
                const deletedImages = oldProduct.images.filter(img => !newImageUrls.includes(img.image_url));
                for (const img of deletedImages) {
                    const publicId = extractPublicId(img.image_url);
                    if (publicId) cloudinary.uploader.destroy(publicId).catch(err => console.error('Lỗi xóa Cloudinary khi update:', err));
                }
            }

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
            // Lấy danh sách ảnh trước khi xóa DB
            const product = await ProductModel.getById(req.params.id);
            if (!product) return sendResponse(res, 404, false, 'Không tìm thấy sản phẩm');

            // Xóa ảnh trên Cloudinary
            const images = product.images || [];
            for (const img of images) {
                const publicId = extractPublicId(img.image_url);
                if (publicId) {
                    await cloudinary.uploader.destroy(publicId).catch(err => console.error('Lỗi xóa Cloudinary:', err));
                }
            }

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
