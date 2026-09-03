const pool = require('../config/database');

const BrandModel = {
    getAll: async () => {
        const [rows] = await pool.query('SELECT brand_id, brand_name FROM brands ORDER BY brand_name ASC');
        return rows;
    }
};

module.exports = BrandModel;
