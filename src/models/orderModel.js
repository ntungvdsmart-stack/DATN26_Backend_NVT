const pool = require('../config/database');

const OrderModel = {
    // 1. Tạo đơn hàng mới (Online/Storefront)
    createOrder: async (orderData, itemsData) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // 1.1 Tính toán tổng tiền lại từ DB để bảo mật (chống sửa giá ở client)
            let subtotal = 0;
            const validItems = [];
            for (const item of itemsData) {
                // Lấy giá hiện tại từ DB
                const [variants] = await connection.query(
                    'SELECT price, product_id FROM product_variants WHERE variant_id = ?',
                    [item.variant_id]
                );
                if (variants.length === 0) throw new Error(`Không tìm thấy variant_id = ${item.variant_id}`);
                const price = Number(variants[0].price);
                const qty = Number(item.quantity);
                subtotal += (price * qty);
                validItems.push({
                    variant_id: item.variant_id,
                    quantity: qty,
                    unit_price: price,
                    line_discount: 0 // Tương lai có thể thêm
                });

                // Kiểm tra tồn kho
                const MAIN_BRANCH_ID = 1;
                const [inv] = await connection.query(
                    'SELECT quantity FROM inventory WHERE variant_id = ? AND branch_id = ? FOR UPDATE',
                    [item.variant_id, MAIN_BRANCH_ID]
                );
                const currentStock = inv.length > 0 ? Number(inv[0].quantity) : 0;
                if (currentStock < qty) {
                    throw new Error(`Sản phẩm variant_id = ${item.variant_id} không đủ tồn kho`);
                }

                // Trừ tồn kho
                await connection.query(
                    'UPDATE inventory SET quantity = quantity - ? WHERE variant_id = ? AND branch_id = ?',
                    [qty, item.variant_id, MAIN_BRANCH_ID]
                );
            }

            const discount = Number(orderData.discount_amount) || 0;
            const total = subtotal - discount;
            const orderCode = `ORD-${Date.now().toString().slice(-6)}-${Math.floor(Math.random()*1000)}`;

            // 1.2 Tạo Order
            // Nếu có shipping address là chuỗi, lưu vào snapshot
            const [orderResult] = await connection.query(
                `INSERT INTO orders (
                    order_code, channel, customer_id, branch_id, staff_id, order_status, 
                    subtotal_amount, discount_amount, total_amount, shipping_address_snapshot
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    orderCode, 'online', orderData.customer_id || null, null, null, 'pending',
                    subtotal, discount, total, orderData.shipping_address_snapshot || ''
                ]
            );
            const orderId = orderResult.insertId;

            // 1.3 Tạo Order Items
            for (const vItem of validItems) {
                await connection.query(
                    `INSERT INTO order_items (order_id, variant_id, quantity, unit_price, line_discount)
                     VALUES (?, ?, ?, ?, ?)`,
                    [orderId, vItem.variant_id, vItem.quantity, vItem.unit_price, vItem.line_discount]
                );
            }

            // 1.4 Ghi log Order History
            await connection.query(
                'INSERT INTO order_status_history (order_id, status, note) VALUES (?, ?, ?)',
                [orderId, 'pending', 'Khách hàng đặt hàng online']
            );

            // 1.5 Tạo Payment Pending
            await connection.query(
                'INSERT INTO payments (order_id, payment_method, amount, payment_status) VALUES (?, ?, ?, ?)',
                [orderId, orderData.payment_method || 'cash', total, 'pending']
            );

            await connection.commit();
            return { order_id: orderId, order_code: orderCode, total_amount: total };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    },

    // 2. Lấy danh sách đơn hàng cho Admin
    getAllOrdersAdmin: async () => {
        const [rows] = await pool.query(`
            SELECT 
                o.order_id, o.order_code, o.channel, o.order_status, o.total_amount, o.created_at,
                o.shipping_address_snapshot,
                c.full_name as customer_name, c.phone as customer_phone,
                p.payment_method, p.payment_status
            FROM orders o
            LEFT JOIN customers c ON o.customer_id = c.customer_id
            LEFT JOIN payments p ON o.order_id = p.order_id
            ORDER BY o.created_at DESC
        `);
        return rows;
    },

    // 3. Cập nhật trạng thái đơn hàng
    updateOrderStatus: async (orderId, newStatus, accountId, note) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [order] = await connection.query('SELECT order_status FROM orders WHERE order_id = ? FOR UPDATE', [orderId]);
            if (order.length === 0) throw new Error('Không tìm thấy đơn hàng');
            const currentStatus = order[0].order_status;

            if (currentStatus === newStatus) {
                throw new Error('Trạng thái mới giống trạng thái hiện tại');
            }

            // Nếu hủy đơn hàng, cộng lại tồn kho
            if (newStatus === 'cancelled' && currentStatus !== 'cancelled') {
                const MAIN_BRANCH_ID = 1;
                const [items] = await connection.query('SELECT variant_id, quantity FROM order_items WHERE order_id = ?', [orderId]);
                for (const item of items) {
                    await connection.query(
                        'UPDATE inventory SET quantity = quantity + ? WHERE variant_id = ? AND branch_id = ?',
                        [item.quantity, item.variant_id, MAIN_BRANCH_ID]
                    );
                }
            }

            // Update status
            await connection.query('UPDATE orders SET order_status = ? WHERE order_id = ?', [newStatus, orderId]);

            // Nếu update thành công (completed), có thể update payment
            if (newStatus === 'completed') {
                 await connection.query('UPDATE payments SET payment_status = ? WHERE order_id = ?', ['success', orderId]);
            }

            // Ghi log history
            await connection.query(
                'INSERT INTO order_status_history (order_id, status, changed_by, note) VALUES (?, ?, ?, ?)',
                [orderId, newStatus, accountId, note || `Đổi trạng thái thành ${newStatus}`]
            );

            await connection.commit();
            return true;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
};

module.exports = OrderModel;
