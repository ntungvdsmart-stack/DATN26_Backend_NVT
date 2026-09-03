const pool = require('../config/database');

const OrderService = {
    /**
     * Tạo đơn hàng POS (Bán tại quầy)
     * System Design Pattern: Service Layer & Unit of Work (Transaction)
     * Đảm bảo cập nhật 5 bảng: orders, order_items, order_status_history, inventory, activity_logs
     */
    createPOSOrder: async (orderData) => {
        const { branch_id, staff_id, customer_id, items, subtotal_amount, discount_amount, total_amount } = orderData;
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            // 1. Sinh mã đơn hàng duy nhất (Ví dụ: POS-1698765432-888)
            const orderCode = `POS-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

            // 2. Lưu vào bảng `orders`
            // Đơn POS mặc định trạng thái là 'completed' (đã thanh toán tại quầy)
            const [orderResult] = await connection.query(
                `INSERT INTO orders 
                (order_code, channel, customer_id, branch_id, staff_id, order_status, subtotal_amount, discount_amount, total_amount) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [orderCode, 'pos', customer_id || null, branch_id, staff_id, 'completed', subtotal_amount, discount_amount, total_amount]
            );
            const orderId = orderResult.insertId;

            // 3. Xử lý từng mặt hàng (order_items & inventory)
            for (const item of items) {
                const { variant_id, quantity, unit_price, line_discount = 0 } = item;

                // 3.1. KHÓA DÒNG (Row-level lock) & Kiểm tra tồn kho tránh Race Condition
                // Dùng FOR UPDATE để khóa dòng inventory này lại cho tới khi commit/rollback
                const [inventoryRows] = await connection.query(
                    `SELECT quantity FROM inventory WHERE variant_id = ? AND branch_id = ? FOR UPDATE`,
                    [variant_id, branch_id]
                );

                if (inventoryRows.length === 0 || inventoryRows[0].quantity < quantity) {
                    throw new Error(`Sản phẩm (Variant ID: ${variant_id}) không đủ tồn kho tại chi nhánh này.`);
                }

                // 3.2. Lưu vào bảng `order_items`
                await connection.query(
                    `INSERT INTO order_items (order_id, variant_id, quantity, unit_price, line_discount) 
                    VALUES (?, ?, ?, ?, ?)`,
                    [orderId, variant_id, quantity, unit_price, line_discount]
                );

                // 3.3. Cập nhật (Trừ) số lượng trong bảng `inventory`
                await connection.query(
                    `UPDATE inventory SET quantity = quantity - ? WHERE variant_id = ? AND branch_id = ?`,
                    [quantity, variant_id, branch_id]
                );
            }

            // 4. Lưu lịch sử trạng thái đơn hàng `order_status_history`
            await connection.query(
                `INSERT INTO order_status_history (order_id, status, changed_by, note) 
                VALUES (?, ?, ?, ?)`,
                [orderId, 'completed', staff_id, 'Đơn hàng POS thanh toán thành công tại quầy']
            );

            // 5. Ghi nhận hành động vào `activity_logs`
            await connection.query(
                `INSERT INTO activity_logs (account_id, action, target_table, target_id, description) 
                VALUES (?, ?, ?, ?, ?)`,
                [staff_id, 'CREATE_POS_ORDER', 'orders', orderId, `Tạo đơn hàng POS thành công. Mã: ${orderCode}`]
            );

            // Xác nhận Giao dịch (Commit)
            await connection.commit();
            return { orderId, orderCode };

        } catch (error) {
            // Hủy Giao dịch nếu có lỗi (Rollback)
            await connection.rollback();
            throw error; // Ném lỗi ra cho Controller xử lý
        } finally {
            // Luôn giải phóng Connection về Pool
            connection.release();
        }
    }
};

module.exports = OrderService;
