const { verifyToken } = require('../utils/jwtHelper');
const { sendResponse } = require('../utils/responseHelper');
const pool = require('../config/database');

const resolveUser = async (token) => {
    const decoded = verifyToken(token);
    if (!decoded || !Number.isSafeInteger(Number(decoded.id))) return null;
    if (decoded.role === 'customer') {
        const [[customer]] = await pool.query('SELECT customer_id, auth_version FROM customers WHERE customer_id = ? AND is_active = 1', [decoded.id]);
        return customer && Number(customer.auth_version) === Number(decoded.auth_version || 0) ? { ...decoded, role: 'customer' } : null;
    }
    if (!['admin', 'staff'].includes(decoded.role)) return null;
    const [[account]] = await pool.query('SELECT role_id, branch_id, auth_version FROM accounts WHERE account_id = ? AND is_active = 1', [decoded.id]);
    if (!account || Number(account.auth_version) !== Number(decoded.auth_version || 0)) return null;
    const permissions = await require('../services/roleService').getPermissions(account.role_id);
    return { ...decoded, ...account, permissions, role: Number(account.role_id) === 1 ? 'admin' : 'staff' };
};

const protect = async (req, res, next) => {
    let token;
    
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return sendResponse(res, 401, false, 'Không có quyền truy cập, vui lòng đăng nhập');
    }

    let decoded;
    try { decoded = await resolveUser(token); } catch (error) { return next(error); }
    if (!decoded) {
        return sendResponse(res, 401, false, 'Token không hợp lệ hoặc đã hết hạn');
    }

    req.user = decoded; // Chứa id và role
    next();
};

const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return sendResponse(res, 403, false, 'Không có quyền thực hiện hành động này');
        }
        if (req.user.role === 'admin' && req.baseUrl.endsWith('/orders') && ['/pos', '/quote'].includes(req.path) && (req.path === '/pos' || req.body?.channel === 'pos')) return sendResponse(res, 403, false, 'Quản trị viên quản lý hệ thống; nhân viên thực hiện bán hàng tại quầy');
        const permission = require('../config/permissions').permissionForRequest(req);
        if (req.user.role === 'staff' && permission && !req.user.permissions?.includes(permission)) return sendResponse(res, 403, false, 'Vai trò của bạn không có quyền thực hiện chức năng này');
        next();
    };
};

const optionalProtect = async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }
    if (token) {
        let decoded;
        try { decoded = await resolveUser(token); } catch (error) { return next(error); }
        if (decoded) {
            req.user = decoded;
        }
    }
    next();
};

module.exports = {
    protect,
    optionalProtect,
    authorize,
    resolveUser
};
