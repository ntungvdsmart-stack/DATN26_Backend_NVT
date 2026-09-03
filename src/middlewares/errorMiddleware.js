const { sendResponse } = require('../utils/responseHelper');

const errorHandler = (err, req, res, next) => {
    console.error(err.stack);
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Lỗi máy chủ nội bộ';
    sendResponse(res, statusCode, false, message);
};

module.exports = errorHandler;
