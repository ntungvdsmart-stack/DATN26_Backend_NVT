module.exports = (req, res, next) => {
    // MySQL can coerce "1abc" to 1; never allow that on a destructive request.
    for (const value of Object.values(req.params)) {
        if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
            return res.status(400).json({ success: false, message: 'Mã dữ liệu cần xóa không hợp lệ', data: { code: 'INVALID_ID' } });
        }
    }
    next();
};
