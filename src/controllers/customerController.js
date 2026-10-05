const CustomerModel = require('../models/customerModel');
const bcrypt = require('bcryptjs');
const { sendResponse } = require('../utils/responseHelper');

const CustomerController = {
    // 1. Admin/Staff: Lấy danh sách tất cả khách hàng
    getAllCustomers: async (req, res, next) => {
        try {
            const customers = await CustomerModel.getAllCustomersAdmin();
            return sendResponse(res, 200, true, 'Lấy danh sách khách hàng thành công', customers);
        } catch (error) {
            next(error);
        }
    },

    // 2. Admin/Staff: Lấy chi tiết khách hàng và lịch sử đơn hàng
    getCustomerDetails: async (req, res, next) => {
        try {
            const id = req.params.id;
            const customer = await CustomerModel.getCustomerById(id);
            if (!customer) {
                return sendResponse(res, 404, false, 'Không tìm thấy khách hàng');
            }
            return sendResponse(res, 200, true, 'Lấy thông tin khách hàng thành công', customer);
        } catch (error) {
            next(error);
        }
    },

    // 3. Admin/Staff: Thay đổi trạng thái khách hàng (Khóa/Mở khóa)
    updateCustomerStatus: async (req, res, next) => {
        try {
            const id = req.params.id;
            const { is_active } = req.body;
            
            if (is_active === undefined) {
                return sendResponse(res, 400, false, 'Trạng thái is_active là bắt buộc');
            }

            const success = await CustomerModel.updateCustomerStatus(id, is_active);
            if (!success) {
                return sendResponse(res, 404, false, 'Không tìm thấy khách hàng để cập nhật');
            }

            return sendResponse(res, 200, true, 'Cập nhật trạng thái khách hàng thành công');
        } catch (error) {
            next(error);
        }
    },

    // 4. Admin/Staff: Tạo khách hàng thủ công (hoặc POS)
    createCustomerAdmin: async (req, res, next) => {
        try {
            const { full_name, phone, email } = req.body;

            if (!full_name) {
                return sendResponse(res, 400, false, 'Tên khách hàng là bắt buộc');
            }
            if (!phone && !email) {
                return sendResponse(res, 400, false, 'Cần cung cấp Số điện thoại hoặc Email');
            }

            if (email) {
                const emailExists = await CustomerModel.checkEmailExists(email);
                if (emailExists) {
                    return sendResponse(res, 400, false, 'Email đã được sử dụng');
                }
            }

            if (phone) {
                const phoneExists = await CustomerModel.findByPhone(phone);
                if (phoneExists) {
                    return sendResponse(res, 400, false, 'Số điện thoại đã được sử dụng');
                }
            }

            // Tạo khách hàng loại 'guest' (vì tạo nhanh tại quầy hoặc admin)
            const insertId = await CustomerModel.create({
                full_name,
                phone: phone || null,
                email: email || `${phone || Date.now()}@noemail.local`,
                password_hash: null, // Không cần pass
                customer_type: 'guest'
            });

            return sendResponse(res, 201, true, 'Tạo khách hàng thành công', { customer_id: insertId, full_name, phone });
        } catch (error) {
            next(error);
        }
    },

    // ── CUSTOMER SELF-SERVICE (Trang cá nhân) ─────────────────────────────

    // 5. Khách hàng: Lấy thông tin cá nhân
    getMyProfile: async (req, res, next) => {
        try {
            const customerId = req.user.id;
            const profile = await CustomerModel.getProfile(customerId);
            if (!profile) {
                return sendResponse(res, 404, false, 'Không tìm thấy thông tin');
            }
            return sendResponse(res, 200, true, 'OK', profile);
        } catch (error) {
            next(error);
        }
    },

    // 6. Khách hàng: Cập nhật thông tin cá nhân
    updateMyProfile: async (req, res, next) => {
        try {
            const customerId = req.user.id;
            const { full_name, phone } = req.body;

            if (!full_name || full_name.trim().length < 2) {
                return sendResponse(res, 400, false, 'Họ và tên phải có ít nhất 2 ký tự');
            }

            if (phone) {
                const existingCustomer = await CustomerModel.findByPhone(phone);
                // Nếu tìm thấy khách hàng khác đang dùng số này
                if (existingCustomer && existingCustomer.customer_id !== customerId) {
                    return sendResponse(res, 400, false, 'Số điện thoại này đã được tài khoản khác sử dụng');
                }
            }

            await CustomerModel.updateProfile(customerId, { full_name: full_name.trim(), phone });

            // Cập nhật lại thông tin trả về cho frontend refresh
            const updated = await CustomerModel.getProfile(customerId);
            return sendResponse(res, 200, true, 'Cập nhật thông tin thành công', updated);
        } catch (error) {
            next(error);
        }
    },

    // 7. Khách hàng: Đổi mật khẩu
    changeMyPassword: async (req, res, next) => {
        try {
            const customerId = req.user.id;
            const { currentPassword, newPassword } = req.body;

            if (!currentPassword || !newPassword) {
                return sendResponse(res, 400, false, 'Vui lòng nhập mật khẩu hiện tại và mật khẩu mới');
            }
            if (newPassword.length < 6) {
                return sendResponse(res, 400, false, 'Mật khẩu mới phải có ít nhất 6 ký tự');
            }

            const currentHash = await CustomerModel.getPasswordHash(customerId);
            if (!currentHash) {
                return sendResponse(res, 400, false, 'Tài khoản không hỗ trợ đổi mật khẩu (tài khoản POS)');
            }

            const isMatch = await bcrypt.compare(currentPassword, currentHash);
            if (!isMatch) {
                return sendResponse(res, 400, false, 'Mật khẩu hiện tại không đúng');
            }

            const salt = await bcrypt.genSalt(10);
            const newHash = await bcrypt.hash(newPassword, salt);
            await CustomerModel.updatePassword(customerId, newHash);

            return sendResponse(res, 200, true, 'Đổi mật khẩu thành công');
        } catch (error) {
            next(error);
        }
    },

    // 8. Khách hàng: Lấy lịch sử đơn hàng
    getMyOrders: async (req, res, next) => {
        try {
            const customerId = req.user.id;
            const orders = await CustomerModel.getMyOrders(customerId);
            return sendResponse(res, 200, true, 'OK', orders);
        } catch (error) {
            next(error);
        }
    },

    // 9. Khách hàng: Lấy chi tiết 1 đơn hàng
    getMyOrderDetail: async (req, res, next) => {
        try {
            const customerId = req.user.id;
            const orderId = req.params.id;
            const order = await CustomerModel.getMyOrderDetail(customerId, orderId);
            if (!order) {
                return sendResponse(res, 404, false, 'Không tìm thấy đơn hàng');
            }
            return sendResponse(res, 200, true, 'OK', order);
        } catch (error) {
            next(error);
        }
    }
};

module.exports = CustomerController;
