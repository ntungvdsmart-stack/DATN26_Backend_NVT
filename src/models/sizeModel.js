const pool = require('../config/database');

const SizeModel = {
    getAll: async () => {
        const [rows] = await pool.query('SELECT size_id, size_value FROM sizes ORDER BY size_id');
        return rows;
    },
    create: async (size_value) => {
        const [result] = await pool.query(
            'INSERT INTO sizes (size_value) VALUES (?)',
            [size_value]
        );
        return result.insertId;
    },
    update: async (id, size_value) => {
        const [result] = await pool.query(
            'UPDATE sizes SET size_value = ? WHERE size_id = ?',
            [size_value, id]
        );
        return result.affectedRows;
    },
    delete: async (id) => {
        const [result] = await pool.query('DELETE FROM sizes WHERE size_id = ?', [id]);
        return result.affectedRows;
    }
};

module.exports = SizeModel;
