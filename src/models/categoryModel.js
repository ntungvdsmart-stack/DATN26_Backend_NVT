const pool = require('../config/database');
const saveCategory = async (id, name, parentId, featured = {}) => {
    const image = featured.image_url == null ? null : featured.image_url;
    const enabled = featured.is_featured ?? false;
    const order = featured.display_order ?? 0;
    if (image !== null) {
        try {
            const url = new URL(image);
            if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error();
        } catch { throw Object.assign(new Error('URL ảnh không hợp lệ'), { statusCode: 400 }); }
    }
    if ((image !== null && (typeof image !== 'string' || image.length > 1000 || !/^https?:\/\//i.test(image))) || ![true,false,0,1].includes(enabled) || !Number.isInteger(order) || order < 0 || order > 9999) throw Object.assign(new Error('Ảnh phải là URL HTTP/HTTPS; thứ tự từ 0 đến 9999'), { statusCode: 400 });
    if (enabled && !image) throw Object.assign(new Error('Danh mục nổi bật cần có ảnh'), { statusCode: 400 });
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [categories] = await connection.query('SELECT category_id, category_name, parent_id FROM categories FOR UPDATE');
        if (id && !categories.some(c => c.category_id === Number(id))) throw Object.assign(new Error('Không tìm thấy danh mục'), { statusCode: 404 });
        const parent = parentId == null || parentId === '' ? null : Number(parentId);
        if (parent != null && (!Number.isSafeInteger(parent) || !categories.some(c => c.category_id === parent))) throw Object.assign(new Error('Danh mục cha không tồn tại'), { statusCode: 400 });
        let ancestor = parent;
        const visited = new Set();
        while (ancestor != null) {
            if (ancestor === Number(id) || visited.has(ancestor)) throw Object.assign(new Error('Không được tạo vòng lặp danh mục cha/con'), { statusCode: 400 });
            visited.add(ancestor);
            ancestor = categories.find(c => c.category_id === ancestor)?.parent_id ?? null;
        }
        if (categories.some(c => c.category_id !== Number(id) && c.parent_id === parent && c.category_name.localeCompare(name.trim(), 'vi', { sensitivity: 'base' }) === 0)) throw Object.assign(new Error('Danh mục đã tồn tại ở cấp này'), { statusCode: 409 });
        const [result] = id ? await connection.query('UPDATE categories SET category_name = ?, parent_id = ?, image_url = ?, is_featured = ?, display_order = ? WHERE category_id = ?', [name.trim(), parent, image, enabled, order, id]) : await connection.query('INSERT INTO categories (category_name,parent_id,image_url,is_featured,display_order) VALUES (?, ?, ?, ?, ?)', [name.trim(), parent, image, enabled, order]);
        await connection.commit();
        return id ? result.affectedRows : result.insertId;
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
};

const CategoryModel = {
    getAll: async () => {
        // Lấy danh mục kèm theo tên danh mục cha (nếu có)
        const [rows] = await pool.query(`
            SELECT c1.category_id, c1.category_name, c1.parent_id, c2.category_name as parent_name
            FROM categories c1
            LEFT JOIN categories c2 ON c1.parent_id = c2.category_id
            ORDER BY c1.parent_id ASC, c1.category_name ASC
        `);
        return rows;
    },
    create: async (category_name, parent_id = null, featured = {}) => {
        return saveCategory(null, category_name, parent_id, featured);
    },
    update: async (id, category_name, parent_id = null, featured = {}) => {
        return saveCategory(id, category_name, parent_id, featured);
    },
    delete: async (id, accountId) => require('../services/referenceDeletionService').deleteReference('categories', id, accountId)
};

module.exports = CategoryModel;
