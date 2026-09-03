const pool = require('../config/database');

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
    }
};

module.exports = CategoryModel;
