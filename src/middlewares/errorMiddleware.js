const { sendResponse } = require('../utils/responseHelper');

const errorHandler = (err, req, res, next) => {
    console.error(err.stack);
    let statusCode = err.statusCode || err.status || 500;
    let message = err.message || 'Lỗi máy chủ nội bộ';
    if (err.code === 'ER_DUP_ENTRY') { statusCode = 409; message = 'Dữ liệu đã tồn tại. Vui lòng kiểm tra lại'; }
    if (err.code === 'ER_NO_REFERENCED_ROW_2') { statusCode = 400; message = 'Dữ liệu liên kết không tồn tại hoặc đã bị xóa'; }
    if (['ER_ROW_IS_REFERENCED', 'ER_ROW_IS_REFERENCED_2'].includes(err.code)) { statusCode = 409; message = 'Dữ liệu đang được sử dụng. Hãy chuyển dữ liệu liên quan hoặc ngừng kích hoạt để giữ lịch sử'; }
    if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(err.code)) { statusCode = 409; message = 'Dữ liệu đang được một thao tác khác cập nhật. Vui lòng tải lại và thử lại'; }
    if (err.code === 'LIMIT_FILE_SIZE') { statusCode = 413; message = 'Mỗi ảnh được phép tối đa 5 MB'; }
    if (['LIMIT_FILE_COUNT','LIMIT_UNEXPECTED_FILE'].includes(err.code)) { statusCode = 400; message = 'Chọn tối đa 10 ảnh và dùng trường images'; }
    if (statusCode >= 500) message = 'Máy chủ gặp lỗi. Vui lòng thử lại sau';
    const data = err.code === 'PRODUCT_IN_USE' ? { code: 'PRODUCT_IN_USE', can_deactivate: true } : err.details || (statusCode === 409 && err.code?.startsWith('ER_') ? { code: ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(err.code) ? 'CONCURRENT_UPDATE' : 'DATA_CONFLICT' } : null);
    sendResponse(res, statusCode, false, message, data);
};

module.exports = errorHandler;
