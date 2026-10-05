// Singleton giữ instance Socket.IO để dùng được ở cả những nơi không có `req`
// (VD: tác vụ chạy nền kiểm tra thanh toán Stripe).
let ioInstance = null;

const setIO = (io) => { ioInstance = io; };
const getIO = () => ioInstance;

// Quy ước phòng (room):
//  - staff_room          : tất cả admin + nhân viên (nhận thông báo đơn mới)
//  - account_<id>        : 1 tài khoản nhân viên/admin cụ thể
//  - customer_<id>       : 1 khách hàng cụ thể
const ROOMS = {
    STAFF: 'staff_room',
    account: (id) => `account_${id}`,
    customer: (id) => `customer_${id}`
};

module.exports = { setIO, getIO, ROOMS };
