const OrderService = require('../services/orderService');
const { sendResponse } = require('../utils/responseHelper');
const pool = require('../config/database');

const OrderController = {
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
            const result = await OrderService.listOrders({
                page, limit, status, channel, payment_status, search, date_from, date_to, branch_id
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

            const result = await OrderService.updateOrderStatus(orderId, status, { accountId, note });
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

    assignOrder: async (req, res, next) => {
        try {
            const orderId = req.params.id;
            const { branch_id, staff_id } = req.body;
            const accountId = req.user.id || req.user.user_id;

            if (!branch_id || !staff_id) {
                return sendResponse(res, 400, false, 'Vui lòng chọn chi nhánh và nhân viên');
            }

            await OrderService.assignOrder(orderId, branch_id, staff_id, accountId);
            return sendResponse(res, 200, true, 'Phân công đơn hàng thành công');
        } catch (error) {
            next(error);
        }
    },

    // 5. Tạo đơn POS (Bán tại quầy)
    createPOSOrder: async (req, res, next) => {
        try {
            const { customer_id, items, payment_method, promo_code, promotion_id, cash_received, note } = req.body;
            const staffId = req.user.id || req.user.user_id;
            const branchId = req.user.branch_id || 1;

            const result = await OrderService.createPOSOrder({
                staffId,
                branchId,
                customerId: customer_id,
                items,
                paymentMethod: payment_method,
                promoCode: promo_code,
                promotionId: promotion_id,
                cashReceived: cash_received,
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
