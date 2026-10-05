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
    },
    create: async (category_name, parent_id = null) => {
        const [result] = await pool.query(
            'INSERT INTO categories (category_name, parent_id) VALUES (?, ?)',
            [category_name, parent_id]
        );
        return result.insertId;
    },
    update: async (id, category_name, parent_id = null) => {
        const [result] = await pool.query(
            'UPDATE categories SET category_name = ?, parent_id = ? WHERE category_id = ?',
            [category_name, parent_id, id]
        );
        return result.affectedRows;
    },
    delete: async (id) => {
        const [result] = await pool.query('DELETE FROM categories WHERE category_id = ?', [id]);
        return result.affectedRows;
    }
};

module.exports = CategoryModel;
