const OrderModel = require('../models/orderModel');
const { sendResponse } = require('../utils/responseHelper');

const OrderController = {
    // 1. Tạo đơn hàng mới
    createOrder: async (req, res, next) => {
        try {
            const { items, customer, payment_method, shipping_address } = req.body;
            
            if (!items || items.length === 0) {
                return sendResponse(res, 400, false, 'Giỏ hàng trống');
            }

            // customer_id có thể truyền từ JWT token nếu khách đã đăng nhập (req.user)
            // hoặc lấy từ req.body nếu là luồng khách chưa đăng nhập.
            const customerId = req.user ? req.user.user_id : null;

            const orderData = {
                customer_id: customerId,
                payment_method: payment_method || 'cash',
                shipping_address_snapshot: `Tên: ${customer?.fullName || 'Khách'}, SĐT: ${customer?.phone || ''}, ĐC: ${shipping_address || ''}`,
                discount_amount: 0
            };

            const result = await OrderModel.createOrder(orderData, items);
            sendResponse(res, 201, true, 'Đặt hàng thành công', result);
        } catch (error) {
            if (error.message.includes('không đủ tồn kho')) {
                return sendResponse(res, 400, false, error.message);
            }
            next(error);
        }
    },

    // 2. Admin lấy danh sách đơn hàng
    getAllOrders: async (req, res, next) => {
        try {
            const orders = await OrderModel.getAllOrdersAdmin();
            sendResponse(res, 200, true, 'Lấy danh sách đơn hàng thành công', orders);
        } catch (error) {
            next(error);
        }
    },

    // 3. Admin đổi trạng thái đơn hàng
    updateOrderStatus: async (req, res, next) => {
        try {
            const orderId = req.params.id;
            const { status, note } = req.body;
            const accountId = req.user.user_id; // từ authMiddleware

            if (!['pending', 'confirmed', 'processing', 'shipping', 'completed', 'cancelled', 'returned'].includes(status)) {
                return sendResponse(res, 400, false, 'Trạng thái đơn hàng không hợp lệ');
            }

            await OrderModel.updateOrderStatus(orderId, status, accountId, note);
            sendResponse(res, 200, true, 'Cập nhật trạng thái thành công');
        } catch (error) {
            if (error.message.includes('Trạng thái') || error.message.includes('Không tìm thấy')) {
                return sendResponse(res, 400, false, error.message);
            }
            next(error);
        }
    }
};

module.exports = OrderController;
