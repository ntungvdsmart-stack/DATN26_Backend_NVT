const pool = require('../config/database');

const OrderModel = {
    // 1. Tạo đơn hàng mới (Online/Storefront)
    createOrder: async (orderData, itemsData) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // 1.1 Tính toán giá & thu thập items
            let subtotal = 0;
            const validItems = [];
            for (const item of itemsData) {
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
                    line_discount: 0
                });
            }

            // 1.1.5 Thuật toán Smart Routing: Tìm chi nhánh tối ưu để giao đơn Online
            // Lấy danh sách các chi nhánh đang hoạt động
            let branchesQuery = 'SELECT branch_id FROM branches WHERE is_active = 1 ORDER BY branch_id = 1 DESC';
            let branchesParams = [];
            
            // Nếu có tọa độ khách hàng, ưu tiên tìm chi nhánh gần nhất (Smart Routing theo vị trí)
            if (orderData.shipping_latitude && orderData.shipping_longitude) {
                // Công thức Haversine để tính khoảng cách
                branchesQuery = `
                    SELECT branch_id, 
                    ( 6371 * acos( cos( radians(?) ) * cos( radians( latitude ) ) 
                    * cos( radians( longitude ) - radians(?) ) + sin( radians(?) ) 
                    * sin( radians( latitude ) ) ) ) AS distance 
                    FROM branches 
                    WHERE is_active = 1 
                    ORDER BY distance ASC
                `;
                branchesParams = [orderData.shipping_latitude, orderData.shipping_longitude, orderData.shipping_latitude];
            }

            const [branches] = await connection.query(branchesQuery, branchesParams);
            let selectedBranchId = null;

            for (const branch of branches) {
                let hasEnough = true;
                for (const item of validItems) {
                    const [inv] = await connection.query(
                        'SELECT quantity FROM inventory WHERE variant_id = ? AND branch_id = ?',
                        [item.variant_id, branch.branch_id]
                    );
                    const stock = inv.length > 0 ? Number(inv[0].quantity) : 0;
                    if (stock < item.quantity) {
                        hasEnough = false;
                        break;
                    }
                }
                // Nếu chi nhánh này có đủ tất cả các món trong giỏ hàng
                if (hasEnough) {
                    selectedBranchId = branch.branch_id;
                    break;
                }
            }

            if (!selectedBranchId) {
                throw new Error('Rất tiếc, hiện tại không có chi nhánh nào đủ hàng cho toàn bộ sản phẩm trong giỏ của bạn. Vui lòng giảm số lượng hoặc chia nhỏ đơn hàng.');
            }

            // 1.1.6 Trừ tồn kho tại chi nhánh đã chọn (Dùng FOR UPDATE để tránh race condition)
            for (const item of validItems) {
                const [inv] = await connection.query(
                    'SELECT quantity FROM inventory WHERE variant_id = ? AND branch_id = ? FOR UPDATE',
                    [item.variant_id, selectedBranchId]
                );
                const currentStock = inv.length > 0 ? Number(inv[0].quantity) : 0;
                if (currentStock < item.quantity) {
                    throw new Error(`Sản phẩm variant_id = ${item.variant_id} vừa hết hàng tại chi nhánh xử lý.`);
                }
                await connection.query(
                    'UPDATE inventory SET quantity = quantity - ? WHERE variant_id = ? AND branch_id = ?',
                    [item.quantity, item.variant_id, selectedBranchId]
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
                    subtotal_amount, discount_amount, total_amount, shipping_address_snapshot,
                    shipping_latitude, shipping_longitude
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    orderCode, 'online', orderData.customer_id || null, selectedBranchId, null, 'pending',
                    subtotal, discount, total, orderData.shipping_address_snapshot || '',
                    orderData.shipping_latitude || null, orderData.shipping_longitude || null
                ]
            );
            const orderId = orderResult.insertId;

            // 1.2.1 Insert Promotion Usage if any
            if (orderData.promotion_id && discount > 0) {
                await connection.query(
                    'INSERT INTO order_promotions (order_id, promotion_id, discount_applied) VALUES (?, ?, ?)',
                    [orderId, orderData.promotion_id, discount]
                );
            }

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
                const [orderInfo] = await connection.query('SELECT branch_id FROM orders WHERE order_id = ?', [orderId]);
                const targetBranchId = orderInfo[0].branch_id || 1;
                
                const [items] = await connection.query('SELECT variant_id, quantity FROM order_items WHERE order_id = ?', [orderId]);
                for (const item of items) {
                    await connection.query(
                        'UPDATE inventory SET quantity = quantity + ? WHERE variant_id = ? AND branch_id = ?',
                        [item.quantity, item.variant_id, targetBranchId]
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

            // Gửi thông báo cho khách hàng
            const [orderDataForNotif] = await connection.query('SELECT order_code, customer_id FROM orders WHERE order_id = ?', [orderId]);
            if (orderDataForNotif.length > 0 && orderDataForNotif[0].customer_id) {
                const orderCode = orderDataForNotif[0].order_code;
                const customerId = orderDataForNotif[0].customer_id;
                let notifContent = `Đơn hàng ${orderCode} của bạn đã được cập nhật trạng thái: ${newStatus}`;
                
                const statusMap = {
                    'confirmed': 'đã được xác nhận',
                    'processing': 'đang được xử lý',
                    'shipping': 'đang được giao đến bạn',
                    'completed': 'đã giao thành công',
                    'cancelled': 'đã bị hủy',
                    'returned': 'đã hoàn trả'
                };
                
                if (statusMap[newStatus]) {
                    notifContent = `Đơn hàng ${orderCode} của bạn ${statusMap[newStatus]}.`;
                }

                await connection.query(
                    `INSERT INTO notifications (customer_id, notif_type, content, related_order_id, is_read) VALUES (?, ?, ?, ?, 0)`,
                    [customerId, 'order_status', notifContent, orderId]
                );
            }

            await connection.commit();
            return true;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    },

    // 4. Tìm đơn hàng theo Order Code (Tra cứu)
    findByOrderCode: async (orderCode) => {
        const [rows] = await pool.query(`
            SELECT 
                o.order_id, o.order_code, o.channel, o.order_status, 
                o.subtotal_amount, o.discount_amount, o.total_amount, 
                o.shipping_address_snapshot, o.created_at,
                c.full_name as customer_name
            FROM orders o
            LEFT JOIN customers c ON o.customer_id = c.customer_id
            WHERE o.order_code = ?
        `, [orderCode]);
        return rows.length > 0 ? rows[0] : null;
    }
};

module.exports = OrderModel;
