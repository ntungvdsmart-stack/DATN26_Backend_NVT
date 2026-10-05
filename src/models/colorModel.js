const pool = require('../config/database');

const ColorModel = {
    getAll: async () => {
        const [rows] = await pool.query('SELECT color_id, color_name, hex_code FROM colors ORDER BY color_name');
        return rows;
    },
    create: async (color_name, hex_code) => {
        const [result] = await pool.query(
            'INSERT INTO colors (color_name, hex_code) VALUES (?, ?)',
            [color_name, hex_code || null]
        );
        return result.insertId;
    },
    update: async (id, color_name, hex_code) => {
        const [result] = await pool.query(
            'UPDATE colors SET color_name = ?, hex_code = ? WHERE color_id = ?',
            [color_name, hex_code || null, id]
        );
        return result.affectedRows;
    },
    delete: async (id) => {
        const [result] = await pool.query('DELETE FROM colors WHERE color_id = ?', [id]);
        return result.affectedRows;
    }
};

module.exports = ColorModel;
