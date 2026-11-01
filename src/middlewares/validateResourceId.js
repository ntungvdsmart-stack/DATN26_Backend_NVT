// Reject values MySQL would silently coerce (such as "12abc" or "1.5").
module.exports = (req, res, next) => {
    const id = req.params.id;
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
        return res.status(400).json({ success: false, message: 'Mã dữ liệu không hợp lệ', data: { code: 'INVALID_ID' } });
    }
    next();
};
