const OrderService = require('../services/orderService');
const { sendResponse } = require('../utils/responseHelper');
const pool = require('../config/database');

const OrderController = {
    completePickup: async (req, res, next) => {
        try {
            if (req.user.role === 'staff' && !req.user.permissions?.includes('pos.sell')) return sendResponse(res, 403, false, 'Bạn không có quyền thu tiền tại quầy');
            const result = await OrderService.updateOrderStatus(req.params.id, 'completed', { accountId: req.user.id, note: 'Khách thanh toán và nhận hàng tại quầy', pickup: true, actorBranchId: req.user.branch_id, isAdmin: req.user.role === 'admin' });
            sendResponse(res, 200, true, 'Đã hoàn tất nhận hàng tại quầy', result);
        } catch (error) { next(error); }
    },
    // 1. Tạo đơn hàng mới (Online)
    createOrder: async (req, res, next) => {
        try {
            const { items, customer, payment_method, shipping_address, shipping_latitude, shipping_longitude, promo_code, promotion_id, note } = req.body;
            const customerId = req.user ? req.user.id : null;
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

            const result = await OrderService.createOnlineOrder({
                customerId,
                customer,
                items,
                paymentMethod: payment_method,
                shippingAddress: shipping_address,
                latitude: shipping_latitude,
                longitude: shipping_longitude,
                ipAddress: req.ip?.replace(/^::ffff:/, ''),
                promoCode: promo_code,
                promotionId: promotion_id,
                note,
                frontendUrl
            });

            const message = payment_method === 'stripe' ? 'Vui lòng hoàn tất thanh toán' : 'Đặt hàng thành công';
            return sendResponse(res, 201, true, message, result);
        } catch (error) {
            next(error);
        }
    },

    // Khách hàng tự hủy đơn hàng
    cancelOrderCustomer: async (req, res, next) => {
        try {
            const { orderCode } = req.params;
            const { reason } = req.body || {};
            const result = await OrderService.cancelByCustomer(orderCode, req.user, reason);
            return sendResponse(res, 200, true, 'Đã hủy đơn hàng thành công.' + (result.refund ? ' ' + result.refund : ''));
        } catch (error) {
            next(error);
        }
    },

    // 2. Admin lấy danh sách đơn hàng (có phân trang)
    getAllOrders: async (req, res, next) => {
        try {
            const { page, limit, status, channel, payment_status, search, date_from, date_to, branch_id } = req.query;
            if (req.user.role === 'staff' && !req.user.branch_id) return sendResponse(res, 403, false, 'Tài khoản chưa được phân công chi nhánh');
            const result = await OrderService.listOrders({
                page, limit, status, channel, payment_status, search, date_from, date_to, branch_id: req.user.role === 'staff' ? req.user.branch_id : branch_id, assigned_staff_id: req.user.role === 'staff' ? req.user.id : null
            });
            sendResponse(res, 200, true, 'Lấy danh sách đơn hàng thành công', result);
        } catch (error) {
            next(error);
        }
    },

    // 3. Admin đổi trạng thái đơn hàng
    updateOrderStatus: async (req, res, next) => {
        try {
            const orderId = req.params.id;
            const { status, note } = req.body;
            const accountId = req.user.id || req.user.user_id;

            const result = await OrderService.updateOrderStatus(orderId, status, { accountId, note, actorBranchId: req.user.branch_id, isAdmin: req.user.role === 'admin' });
            return sendResponse(res, 200, true, 'Cập nhật trạng thái đơn hàng thành công', result);
        } catch (error) {
            next(error);
        }
    },

    // 4. Lấy chi tiết đơn hàng
    getOrderDetails: async (req, res, next) => {
        try {
            const orderId = req.params.id;
            const order = await OrderService.getOrderById(orderId);
            if (!order) {
                return sendResponse(res, 404, false, 'Không tìm thấy đơn hàng');
            }
            if (req.user.role === 'staff' && (Number(order.branch_id) !== Number(req.user.branch_id) || (order.channel === 'online' && Number(order.staff_id) !== Number(req.user.id)))) return sendResponse(res, 404, false, 'Không tìm thấy đơn hàng của chi nhánh');
            return sendResponse(res, 200, true, 'Lấy chi tiết đơn hàng thành công', order);
        } catch (error) {
            next(error);
        }
    },

    getBranchSuggestions: async (req, res, next) => {
        try {
            const orderId = req.params.id;
            const suggestions = await OrderService.getBranchSuggestions(orderId);
            return sendResponse(res, 200, true, 'Lấy danh sách chi nhánh gợi ý thành công', suggestions);
        } catch (error) {
            next(error);
        }
    },

    // 5. Tạo đơn POS (Bán tại quầy)
    createPOSOrder: async (req, res, next) => {
        try {
            const { customer_id, items, payment_method, promo_code, promotion_id, cash_received, note, bank_transfer_confirmed } = req.body;
            const staffId = req.user.id || req.user.user_id;
            const branchId = req.user.branch_id || 1;
            if (req.user.role === 'staff' && !req.user.branch_id) return sendResponse(res, 403, false, 'Tài khoản cần được phân công chi nhánh trước khi bán tại quầy');

            const result = await OrderService.createPOSOrder({
                staffId,
                branchId,
                customerId: customer_id,
                items,
                paymentMethod: payment_method,
                promoCode: promo_code,
                promotionId: promotion_id,
                cashReceived: cash_received,
                bankTransferConfirmed: bank_transfer_confirmed,
                note
            });

            return sendResponse(res, 201, true, 'Thanh toán thành công!', result);
        } catch (error) {
            next(error);
        }
    },

    // 6. Tra cứu đơn hàng (Public)
    trackOrder: async (req, res, next) => {
        try {
            const { orderCode } = req.params;
            if (!orderCode) {
                return sendResponse(res, 400, false, 'Vui lòng cung cấp mã đơn hàng');
            }

            const [rows] = await pool.query('SELECT order_id FROM orders WHERE order_code = ?', [orderCode]);
            if (rows.length === 0) {
                return sendResponse(res, 404, false, 'Không tìm thấy đơn hàng với mã này');
            }

            const orderId = rows[0].order_id;
            const fullOrder = await OrderService.getOrderById(orderId);
            if (req.user.role === 'customer' && Number(fullOrder.customer_id) !== Number(req.user.id)) return sendResponse(res, 404, false, 'Không tìm thấy đơn hàng');
            if (req.user.role === 'staff' && (Number(fullOrder.branch_id) !== Number(req.user.branch_id) || (fullOrder.channel === 'online' && Number(fullOrder.staff_id) !== Number(req.user.id)))) return sendResponse(res, 404, false, 'Không tìm thấy đơn hàng của chi nhánh');

            return sendResponse(res, 200, true, 'Tìm thấy đơn hàng', fullOrder);
        } catch (error) {
            next(error);
        }
    },

    // Xóa đơn hàng (Chỉ Admin)
    deleteOrder: async (req, res, next) => {
        try {
            const { id } = req.params;
            await OrderService.deleteOrder(id, req.user.id);
            return sendResponse(res, 200, true, 'Xóa đơn hàng thành công');
        } catch (error) {
            next(error);
        }
    },

    // 7. Lợi gợi ý chi nhánh và sắp xếp theo khoảng cách
    getBranchSuggestions: async (req, res, next) => {
        try {
            const { id } = req.params;
            const result = await OrderService.getBranchSuggestions(id);
            return sendResponse(res, 200, true, 'Lấy danh sách chi nhánh thành công', result);
        } catch (error) {
            next(error);
        }
    },

    // 8. Phân đơn cho chi nhánh/nhân viên
    assignOrder: async (req, res, next) => {
        try {
            const { id } = req.params;
            const { branch_id, staff_id } = req.body;
            await OrderService.assignOrder(id, branch_id, staff_id, req.user.id);
            return sendResponse(res, 200, true, 'Phân đơn thành công');
        } catch (error) {
            next(error);
        }
    }
};

module.exports = OrderController;
