const pool = require('../config/database');

const MaterialModel = {
    getAll: async () => {
        const [rows] = await pool.query('SELECT material_id, material_name FROM materials ORDER BY material_name');
        return rows;
    },
    create: async (material_name) => {
        const [result] = await pool.query(
            'INSERT INTO materials (material_name) VALUES (?)',
            [material_name]
        );
        return result.insertId;
    },
    update: async (id, material_name) => {
        const [result] = await pool.query(
            'UPDATE materials SET material_name = ? WHERE material_id = ?',
            [material_name, id]
        );
        return result.affectedRows;
    },
    delete: async (id) => {
        const [result] = await pool.query('DELETE FROM materials WHERE material_id = ?', [id]);
        return result.affectedRows;
    }
};

module.exports = MaterialModel;
