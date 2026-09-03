const { verifyToken } = require('../utils/jwtHelper');
const { sendResponse } = require('../utils/responseHelper');

const protect = (req, res, next) => {
    let token;
    
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return sendResponse(res, 401, false, 'Không có quyền truy cập, vui lòng đăng nhập');
    }

    const decoded = verifyToken(token);
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
        next();
    };
};

module.exports = {
    protect,
    authorize
};
