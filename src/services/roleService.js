const pool = require('../config/database');
const getPermissions = async (roleId, connection = pool) => {
    if (Number(roleId) === 1) return Object.keys(require('../config/permissions').PERMISSIONS);
    const [rows] = await connection.query('SELECT p.permission_code FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.permission_id WHERE rp.role_id = ?', [roleId]);
    return rows.map(row => row.permission_code);
};
module.exports = { getPermissions };
