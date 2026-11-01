const router = require('express').Router();
const pool = require('../config/database');
const { DEFAULT_GRANTS } = require('../config/permissions');
const { protect, authorize } = require('../middlewares/authMiddleware');
router.use(protect, authorize('admin'));
router.get('/', async (req, res, next) => {
    try {
        const [roles] = await pool.query('SELECT * FROM roles ORDER BY role_id');
        const [permissions] = await pool.query('SELECT * FROM permissions ORDER BY permission_code');
        const [grants] = await pool.query('SELECT rp.role_id, p.permission_code FROM role_permissions rp JOIN permissions p ON p.permission_id = rp.permission_id');
        res.json({ success: true, data: { roles: roles.map(role => ({ ...role, permissions: Number(role.role_id) === 1 ? permissions.map(p => p.permission_code) : grants.filter(g => g.role_id === role.role_id).map(g => g.permission_code) })), permissions } });
    } catch (error) { next(error); }
});
router.put('/:id/permissions', async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const roleId = Number(req.params.id);
        const codes = req.body.permissions;
        if (roleId !== 2 || !Array.isArray(codes) || codes.length > 100 || codes.some(code => typeof code !== 'string' || !DEFAULT_GRANTS.Staff.includes(code))) return res.status(400).json({ success: false, message: 'Chỉ cấu hình quyền nghiệp vụ cho một vai trò nhân viên; sản phẩm/danh mục và khuyến mãi do quản trị viên quản lý' });
        await connection.beginTransaction();
        const [[role]] = await connection.query('SELECT role_id FROM roles WHERE role_id = ? FOR UPDATE', [roleId]);
        if (!role) throw Object.assign(new Error('Không tìm thấy vai trò'), { statusCode: 404 });
        const [permissions] = await connection.query('SELECT permission_id, permission_code FROM permissions');
        if (codes.some(code => !permissions.some(p => p.permission_code === code))) throw Object.assign(new Error('Quyền không tồn tại'), { statusCode: 400 });
        await connection.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
        for (const permission of permissions.filter(p => codes.includes(p.permission_code))) await connection.query('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [roleId, permission.permission_id]);
        await connection.query('INSERT INTO activity_logs (account_id, action, target_table, target_id, description) VALUES (?, ?, ?, ?, ?)', [req.user.id, 'UPDATE_ROLE_PERMISSIONS', 'roles', roleId, `Cập nhật ${new Set(codes).size} quyền cho vai trò`]);
        await connection.commit();
        res.json({ success: true, message: 'Đã cập nhật phân quyền' });
    } catch (error) { await connection.rollback(); next(error); } finally { connection.release(); }
});
module.exports = router;
