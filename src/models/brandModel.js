const pool = require('../config/database');

const BrandModel = {
    getAll: async () => {
        const [rows] = await pool.query('SELECT brand_id, brand_name FROM brands ORDER BY brand_name ASC');
        return rows;
    },
    create: async (brand_name) => {
        const [result] = await pool.query('INSERT INTO brands (brand_name) VALUES (?)', [brand_name]);
        return result.insertId;
    },
    update: async (id, brand_name) => {
        const [result] = await pool.query('UPDATE brands SET brand_name = ? WHERE brand_id = ?', [brand_name, id]);
        return result.affectedRows;
    },
    delete: async (id) => {
        const [result] = await pool.query('DELETE FROM brands WHERE brand_id = ?', [id]);
        return result.affectedRows;
    }
};

module.exports = BrandModel;
