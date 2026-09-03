const pool = require('../config/database');

const AttributeModel = {
    // === KÍCH CỠ (SIZES) ===
    getAllSizes: async () => {
        const [rows] = await pool.query('SELECT size_id, size_value FROM sizes ORDER BY size_id ASC');
        return rows;
    },

    // === MÀU SẮC (COLORS) ===
    getAllColors: async () => {
        const [rows] = await pool.query('SELECT color_id, color_name, hex_code FROM colors ORDER BY color_id ASC');
        return rows;
    },

    // === CHẤT LIỆU (MATERIALS) ===
    getAllMaterials: async () => {
        const [rows] = await pool.query('SELECT material_id, material_name FROM materials ORDER BY material_id ASC');
        return rows;
    }
};

module.exports = AttributeModel;
