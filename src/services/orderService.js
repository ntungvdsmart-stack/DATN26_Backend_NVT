const pool = require('../config/database');
const StripeService = require('./stripeService');
const NotificationService = require('./notificationService');
const LoyaltyService = require('./loyaltyService');
const { getIO, ROOMS } = require('../config/socket');

/* ============================================================================
 * HẰNG SỐ NGHIỆP VỤ
 * ==========================================================================*/
const STATUS_LABELS = {
    pending: 'Chờ xác nhận',
    confirmed: 'Đã xác nhận',
    processing: 'Đang chuẩn bị hàng',
    shipping: 'Đang giao hàng',
    completed: 'Hoàn thành',
    cancelled: 'Đã hủy',
    returned: 'Hoàn trả'
};

// Máy trạng thái đơn hàng: chỉ cho phép chuyển theo đúng luồng
const TRANSITIONS = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['processing', 'cancelled'],
    processing: ['shipping', 'cancelled'],
    shipping: ['completed', 'returned'], // returned = giao thất bại / khách từ chối nhận
    completed: ['returned'],
    cancelled: [],
    returned: []
};

const ONLINE_PAYMENT_METHODS = ['cash', 'stripe'];
const POS_PAYMENT_METHODS = ['cash', 'bank_transfer'];
const PAYMENT_LABELS = { cash: 'Tiền mặt', stripe: 'Thẻ (Stripe)', bank_transfer: 'Chuyển khoản', qr_pos: 'Quét QR', vnpay: 'VNPay', momo: 'MoMo' };
const STRIPE_MIN_AMOUNT = 15000; // ~0.5 USD – mức tối thiểu Stripe chấp nhận
const CUSTOMER_CANCEL_HOURS = 24;

const httpError = (statusCode, message) => {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
};

const money = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;

/** Chuẩn hóa danh sách sản phẩm gửi lên: gộp trùng variant, ép kiểu, validate */
const normalizeItems = (items) => {
    if (!Array.isArray(items) || items.length === 0) throw httpError(400, 'Giỏ hàng trống');
    const map = new Map();
    for (const raw of items) {
        const variantId = Number(raw.variant_id ?? raw.id);
        const qty = Number(raw.quantity ?? raw.qty);
        if (!Number.isInteger(variantId) || variantId <= 0) throw httpError(400, 'Sản phẩm không hợp lệ');
        if (!Number.isInteger(qty) || qty <= 0) throw httpError(400, 'Số lượng sản phẩm không hợp lệ');
        map.set(variantId, (map.get(variantId) || 0) + qty);
    }
    return [...map.entries()].map(([variant_id, quantity]) => ({ variant_id, quantity }));
};

/** Lấy giá + thông tin biến thể từ DB (KHÔNG tin giá từ client) */
const loadVariants = async (conn, items) => {
    const ids = items.map(i => i.variant_id);
    const [rows] = await conn.query(
        `SELECT v.variant_id, v.sku, v.price, v.is_active AS variant_active,
                p.product_id, p.product_name, p.is_active AS product_active
         FROM product_variants v JOIN products p ON p.product_id = v.product_id
         WHERE v.variant_id IN (?)`,
        [ids]
    );
    const byId = new Map(rows.map(r => [r.variant_id, r]));
    return items.map(item => {
        const v = byId.get(item.variant_id);
        if (!v) throw httpError(400, `Sản phẩm (mã biến thể ${item.variant_id}) không tồn tại`);
        if (!v.variant_active || !v.product_active) throw httpError(400, `Sản phẩm "${v.product_name}" (${v.sku}) đã ngừng kinh doanh`);
        return { ...item, unit_price: Number(v.price), sku: v.sku, product_name: v.product_name };
    });
};

const getShippingConfig = async (conn = pool) => {
    let fee = 30000, threshold = 500000;
    try {
        const [rows] = await conn.query(
            "SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('shipping_fee', 'free_shipping_threshold')"
        );
        rows.forEach(r => {
            if (r.setting_key === 'shipping_fee' && r.setting_value !== '' && !isNaN(Number(r.setting_value))) fee = Number(r.setting_value);
            if (r.setting_key === 'free_shipping_threshold' && r.setting_value !== '' && !isNaN(Number(r.setting_value))) threshold = Number(r.setting_value);
        });
    } catch (_) { /* bảng chưa tồn tại → dùng mặc định */ }
    return { fee, threshold };
};

const restoreInventory = async (conn, orderId, branchId) => {
    if (!branchId) return; // Không cộng kho nếu đơn chưa từng gán chi nhánh (chưa trừ kho)
    const [items] = await conn.query('SELECT variant_id, quantity FROM order_items WHERE order_id = ?', [orderId]);
    for (const item of items) {
        await conn.query(
            `INSERT INTO inventory (variant_id, branch_id, quantity) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
            [item.variant_id, branchId, item.quantity]
        );
    }
};

const emitOrdersChanged = (orderId, type = 'UPDATED') => {
    const io = getIO();
    if (io) io.to(ROOMS.STAFF).emit('orders_changed', { order_id: orderId, type });
};

/* ============================================================================
 * SERVICE
 * ==========================================================================*/
const OrderService = {
    STATUS_LABELS,
    TRANSITIONS,
    POS_PAYMENT_METHODS,
    httpError,
    getShippingConfig,

    /**
     * Kiểm tra & tính tiền giảm của 1 mã khuyến mãi (dùng chung cho API "áp mã",
     * đơn online và đơn POS) → đảm bảo frontend không thể tự đặt số tiền giảm.
     */
    evaluatePromotion: async ({ code, promotionId, subtotal, channel, customerId }, conn = pool) => {
        let promo = null;
        if (promotionId) {
            const [rows] = await conn.query('SELECT * FROM promotions WHERE promotion_id = ?', [promotionId]);
            promo = rows[0];
        } else if (code) {
            const [rows] = await conn.query('SELECT * FROM promotions WHERE promo_code = ?', [String(code).trim().toUpperCase()]);
            promo = rows[0];
        }
        if (!promo) throw httpError(404, 'Mã giảm giá không tồn tại');
        if (!promo.is_active) throw httpError(400, 'Mã giảm giá đã bị khóa');

        const now = new Date();
        if (now < new Date(promo.start_date)) throw httpError(400, 'Mã giảm giá chưa đến thời gian áp dụng');
        if (now > new Date(promo.end_date)) throw httpError(400, 'Mã giảm giá đã hết hạn');
        if (channel && promo.channel_scope !== 'both' && promo.channel_scope !== channel) {
            throw httpError(400, `Mã giảm giá chỉ áp dụng cho kênh ${promo.channel_scope === 'pos' ? 'mua tại cửa hàng' : 'mua online'}`);
        }
        const sub = Number(subtotal) || 0;
        if (sub < Number(promo.min_order_amount)) {
            throw httpError(400, `Đơn hàng tối thiểu ${money(promo.min_order_amount)} để áp dụng mã này`);
        }

        const [[usage]] = await conn.query(
            `SELECT COUNT(*) AS total FROM order_promotions op JOIN orders o ON o.order_id = op.order_id
             WHERE op.promotion_id = ? AND o.order_status <> 'cancelled'`,
            [promo.promotion_id]
        );
        if (promo.max_usage_count !== null && Number(usage.total) >= Number(promo.max_usage_count)) {
            throw httpError(400, 'Mã giảm giá đã hết lượt sử dụng');
        }
        if (customerId) {
            const [[mine]] = await conn.query(
                `SELECT COUNT(*) AS cnt FROM order_promotions op JOIN orders o ON o.order_id = op.order_id
                 WHERE op.promotion_id = ? AND o.customer_id = ? AND o.order_status <> 'cancelled'`,
                [promo.promotion_id, customerId]
            );
            if (Number(mine.cnt) >= Number(promo.max_per_customer)) {
                throw httpError(400, 'Khách hàng đã dùng hết lượt cho mã này');
            }
        }

        let discount = promo.discount_type === 'percent'
            ? (sub * Number(promo.discount_value)) / 100
            : Number(promo.discount_value);
        discount = Math.min(Math.round(discount), sub);

        return {
            promotion_id: promo.promotion_id,
            promo_code: promo.promo_code,
            promo_name: promo.promo_name,
            discount_type: promo.discount_type,
            discount_value: Number(promo.discount_value),
            min_order_amount: Number(promo.min_order_amount),
            discount_amount: discount
        };
    },

    /* ------------------------------------------------------------------------
     * ĐƠN ONLINE
     * ----------------------------------------------------------------------*/
    createOnlineOrder: async ({ customerId, customer = {}, items, paymentMethod = 'cash', shippingAddress, latitude, longitude, promoCode, promotionId, note, frontendUrl }) => {
        const method = paymentMethod === 'cod' ? 'cash' : paymentMethod;
        if (!ONLINE_PAYMENT_METHODS.includes(method)) throw httpError(400, 'Phương thức thanh toán không được hỗ trợ');

        const fullName = String(customer.fullName || '').trim();
        const phone = String(customer.phone || '').trim();
        const address = String(shippingAddress || '').trim();
        if (!fullName || !phone || !address) throw httpError(400, 'Vui lòng nhập đầy đủ họ tên, số điện thoại và địa chỉ nhận hàng');
        if (!/^(0|\+84)\d{9,10}$/.test(phone.replace(/[\s.]/g, ''))) throw httpError(400, 'Số điện thoại không hợp lệ');

        const normalized = normalizeItems(items);
        const connection = await pool.getConnection();
        let result;
        try {
            await connection.beginTransaction();
            const lines = await loadVariants(connection, normalized);
            const subtotal = lines.reduce((s, l) => s + l.unit_price * l.quantity, 0);

            // Bỏ tự động gán chi nhánh và trừ kho. Admin sẽ phân công sau.
            const branchId = null;

            // Khuyến mãi được TÍNH LẠI ở server
            let promo = null;
            if (promoCode || promotionId) {
                promo = await OrderService.evaluatePromotion(
                    { code: promoCode, promotionId, subtotal, channel: 'online', customerId }, connection
                );
            }
            const discount = promo ? promo.discount_amount : 0;
            
            let loyaltyDiscount = 0;
            if (customerId) {
                const [cRows] = await connection.query('SELECT loyalty_points FROM customers WHERE customer_id = ?', [customerId]);
                if (cRows.length) {
                    const discountData = LoyaltyService.calcDiscount(Number(cRows[0].loyalty_points) || 0, Math.max(0, subtotal - discount));
                    loyaltyDiscount = discountData.amount;
                }
            }

            const { fee, threshold } = await getShippingConfig(connection);
            const shippingFee = subtotal >= threshold ? 0 : fee;
            const total = Math.max(0, subtotal - discount - loyaltyDiscount + shippingFee);

            if (method === 'stripe' && total < STRIPE_MIN_AMOUNT) {
                throw httpError(400, `Thanh toán thẻ yêu cầu đơn tối thiểu ${money(STRIPE_MIN_AMOUNT)}. Vui lòng chọn COD.`);
            }

            const orderCode = `ORD-${Date.now().toString().slice(-7)}-${Math.floor(100 + Math.random() * 900)}`;
            const snapshot = `Tên: ${fullName}, SĐT: ${phone}, ĐC: ${address}`;

            const [orderRes] = await connection.query(
                `INSERT INTO orders (order_code, channel, customer_id, branch_id, staff_id, order_status,
                    subtotal_amount, discount_amount, loyalty_discount, shipping_fee, total_amount, shipping_address_snapshot,
                    shipping_latitude, shipping_longitude, note)
                 VALUES (?, 'online', ?, ?, NULL, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [orderCode, customerId || null, branchId, subtotal, discount, loyaltyDiscount, shippingFee, total, snapshot,
                 latitude || null, longitude || null, note ? String(note).slice(0, 500) : null]
            );
            const orderId = orderRes.insertId;

            for (const l of lines) {
                await connection.query(
                    'INSERT INTO order_items (order_id, variant_id, quantity, unit_price, line_discount) VALUES (?, ?, ?, ?, 0)',
                    [orderId, l.variant_id, l.quantity, l.unit_price]
                );
            }
            if (promo && discount > 0) {
                await connection.query(
                    'INSERT INTO order_promotions (order_id, promotion_id, discount_applied) VALUES (?, ?, ?)',
                    [orderId, promo.promotion_id, discount]
                );
            }
            await connection.query(
                'INSERT INTO order_status_history (order_id, status, changed_by, note) VALUES (?, ?, NULL, ?)',
                [orderId, 'pending', method === 'stripe' ? 'Khách đặt hàng online – chờ thanh toán thẻ' : 'Khách đặt hàng online – thanh toán khi nhận hàng (COD)']
            );
            await connection.query(
                'INSERT INTO payments (order_id, payment_method, amount, payment_status) VALUES (?, ?, ?, ?)',
                [orderId, method, total, 'pending']
            );
            if (customerId) {
                await connection.query(
                    'INSERT INTO activity_logs (customer_id, action, target_table, target_id, description) VALUES (?, ?, ?, ?, ?)',
                    [customerId, 'CREATE_ORDER', 'orders', orderId, `Đặt đơn online ${orderCode}`]
                );
            }

            await connection.commit();
            result = { order_id: orderId, order_code: orderCode, subtotal_amount: subtotal, discount_amount: discount, shipping_fee: shippingFee, total_amount: total, payment_method: method, lines };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

        // ---- Sau khi commit ----
        if (method === 'stripe') {
            try {
                const session = await StripeService.createCheckoutSession({
                    orderId: result.order_id, orderCode: result.order_code, totalAmount: result.total_amount,
                    customerEmail: customer.email, frontendUrl
                });
                await pool.query('UPDATE payments SET transaction_code = ? WHERE order_id = ?', [session.id, result.order_id]);
                OrderService.watchStripeSession(result.order_id, session.id);
                result.checkoutUrl = session.url;
            } catch (err) {
                // Không tạo được cổng thanh toán → hủy đơn để trả lại tồn kho
                await OrderService.updateOrderStatus(result.order_id, 'cancelled', {
                    note: 'Hệ thống hủy: không tạo được cổng thanh toán Stripe', silent: true
                }).catch(() => {});
                throw httpError(502, 'Không kết nối được cổng thanh toán Stripe: ' + err.message);
            }
        } else {
            NotificationService.notifyStaff({
                content: `🛒 Đơn online mới ${result.order_code} (COD) – ${money(result.total_amount)}. Vui lòng xác nhận!`,
                orderId: result.order_id
            });
        }
        NotificationService.notifyCustomer({
            customerId,
            content: method === 'stripe'
                ? `Đơn hàng ${result.order_code} đã được tạo, vui lòng hoàn tất thanh toán trong ${StripeService.SESSION_TTL_MINUTES} phút.`
                : `Đặt hàng thành công! Đơn ${result.order_code} đang chờ cửa hàng xác nhận.`,
            orderId: result.order_id
        });
        return result;
    },

    /* ------------------------------------------------------------------------
     * THANH TOÁN STRIPE
     * ----------------------------------------------------------------------*/
    /** Đánh dấu đã thanh toán (idempotent – gọi nhiều lần cũng an toàn) */
    markOrderPaid: async (orderId, paymentIntentId) => {
        const connection = await pool.getConnection();
        let order;
        try {
            await connection.beginTransaction();
            const [rows] = await connection.query(
                `SELECT o.order_id, o.order_code, o.order_status, o.customer_id, o.total_amount, p.payment_status
                 FROM orders o JOIN payments p ON p.order_id = o.order_id WHERE o.order_id = ? FOR UPDATE`,
                [orderId]
            );
            if (!rows.length || rows[0].payment_status === 'success') { await connection.rollback(); return false; }
            order = rows[0];

            await connection.query(
                'UPDATE payments SET payment_status = ?, transaction_code = ?, paid_at = NOW() WHERE order_id = ?',
                ['success', paymentIntentId || null, orderId]
            );
            if (order.order_status === 'pending') {
                await connection.query("UPDATE orders SET order_status = 'confirmed' WHERE order_id = ?", [orderId]);
                await connection.query(
                    'INSERT INTO order_status_history (order_id, status, changed_by, note) VALUES (?, ?, NULL, ?)',
                    [orderId, 'confirmed', 'Thanh toán Stripe thành công – hệ thống tự động xác nhận']
                );
            } else if (order.order_status === 'cancelled') {
                // Khách trả tiền sau khi đơn đã bị hủy (hết hạn) → ghi chú để nhân viên hoàn tiền
                await connection.query(
                    'INSERT INTO order_status_history (order_id, status, changed_by, note) VALUES (?, ?, NULL, ?)',
                    [orderId, 'cancelled', '⚠ Nhận được thanh toán sau khi đơn đã hủy – cần hoàn tiền thủ công']
                );
            }
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }

        NotificationService.notifyStaff({
            content: `💳 Đơn ${order.order_code} đã thanh toán thẻ thành công (${money(order.total_amount)}). Vui lòng chuẩn bị hàng!`,
            orderId
        });
        NotificationService.notifyCustomer({
            customerId: order.customer_id,
            content: `Thanh toán đơn ${order.order_code} thành công. Đơn hàng đã được xác nhận!`,
            orderId
        });
        return true;
    },

    /** Kiểm tra trạng thái phiên Stripe và đồng bộ DB. Trả về 'paid' | 'open' | 'expired' | null */
    syncStripeSession: async (orderId, sessionId) => {
        const session = await StripeService.retrieveSession(sessionId);
        if (session.payment_status === 'paid') {
            await OrderService.markOrderPaid(orderId, session.payment_intent);
            return 'paid';
        }
        if (session.status === 'expired') {
            await OrderService.cancelUnpaidOnlineOrder(orderId, 'Hết hạn thanh toán Stripe – hệ thống tự hủy đơn');
            return 'expired';
        }
        return session.status;
    },

    /**
     * LOCAL DEV: localhost không nhận được webhook nên dùng polling để đồng bộ.
     * Khi deploy có webhook vẫn giữ được vì markOrderPaid là idempotent.
     */
    watchStripeSession: (orderId, sessionId) => {
        const startedAt = Date.now();
        const maxMs = (StripeService.SESSION_TTL_MINUTES + 2) * 60 * 1000;
        const timer = setInterval(async () => {
            try {
                const state = await OrderService.syncStripeSession(orderId, sessionId);
                if (state === 'paid' || state === 'expired') return clearInterval(timer);
                if (Date.now() - startedAt > maxMs) {
                    clearInterval(timer);
                    await StripeService.expireSession(sessionId);
                    await OrderService.syncStripeSession(orderId, sessionId).catch(() => {});
                }
            } catch (err) {
                if (Date.now() - startedAt > maxMs) clearInterval(timer);
            }
        }, 4000);
    },

    /** Quét các đơn Stripe treo (VD: server restart làm mất polling) */
    sweepPendingStripeOrders: async () => {
        try {
            const [rows] = await pool.query(
                `SELECT o.order_id, p.transaction_code FROM orders o JOIN payments p ON p.order_id = o.order_id
                 WHERE p.payment_method = 'stripe' AND p.payment_status = 'pending' AND o.order_status = 'pending'
                   AND o.created_at < (NOW() - INTERVAL ? MINUTE)`,
                [StripeService.SESSION_TTL_MINUTES + 5]
            );
            for (const r of rows) {
                if (r.transaction_code && r.transaction_code.startsWith('cs_')) {
                    await StripeService.expireSession(r.transaction_code);
                    await OrderService.syncStripeSession(r.order_id, r.transaction_code).catch(() => {});
                } else {
                    await OrderService.cancelUnpaidOnlineOrder(r.order_id, 'Hết hạn thanh toán – hệ thống tự hủy đơn');
                }
            }
        } catch (err) {
            console.error('[sweepPendingStripeOrders]', err.message);
        }
    },

    cancelUnpaidOnlineOrder: async (orderId, reason) => {
        const [rows] = await pool.query(
            `SELECT o.order_status, p.payment_status FROM orders o JOIN payments p ON p.order_id = o.order_id WHERE o.order_id = ?`,
            [orderId]
        );
        if (!rows.length || rows[0].order_status !== 'pending' || rows[0].payment_status !== 'pending') return false;
        await OrderService.updateOrderStatus(orderId, 'cancelled', { note: reason });
        return true;
    },

    retryStripePayment: async (orderCode, user, frontendUrl) => {
        const order = await OrderService.findOwnedOrder(orderCode, user);
        if (order.order_status !== 'pending' || order.payment_method !== 'stripe' || order.payment_status !== 'pending') {
            throw httpError(400, 'Đơn hàng này không ở trạng thái chờ thanh toán');
        }
        if (order.transaction_code && order.transaction_code.startsWith('cs_')) {
            // Có thể khách đã trả nhưng hệ thống chưa kịp ghi nhận
            const state = await OrderService.syncStripeSession(order.order_id, order.transaction_code).catch(() => null);
            if (state === 'paid') throw httpError(400, 'Đơn hàng đã được thanh toán');
            if (state === 'expired') throw httpError(400, 'Phiên thanh toán đã hết hạn và đơn đã bị hủy. Vui lòng đặt lại.');
            await StripeService.expireSession(order.transaction_code);
        }
        const session = await StripeService.createCheckoutSession({
            orderId: order.order_id, orderCode: order.order_code, totalAmount: order.total_amount, frontendUrl
        });
        await pool.query('UPDATE payments SET transaction_code = ? WHERE order_id = ?', [session.id, order.order_id]);
        OrderService.watchStripeSession(order.order_id, session.id);
        return { checkoutUrl: session.url };
    },

    verifyStripeByOrderCode: async (orderCode) => {
        const [rows] = await pool.query(
            `SELECT o.order_id, p.transaction_code, p.payment_status FROM orders o
             JOIN payments p ON p.order_id = o.order_id WHERE o.order_code = ?`,
            [orderCode]
        );
        if (!rows.length) throw httpError(404, 'Đơn hàng không tồn tại');
        const row = rows[0];
        if (row.payment_status === 'success') return 'paid';
        if (!row.transaction_code || !row.transaction_code.startsWith('cs_')) return row.payment_status;
        return OrderService.syncStripeSession(row.order_id, row.transaction_code);
    },

    /* ------------------------------------------------------------------------
     * CẬP NHẬT TRẠNG THÁI (dùng chung cho nhân viên / khách / hệ thống)
     * ----------------------------------------------------------------------*/
    updateOrderStatus: async (orderId, newStatus, { accountId = null, note = '', silent = false } = {}) => {
        if (!STATUS_LABELS[newStatus]) throw httpError(400, 'Trạng thái đơn hàng không hợp lệ');

        const connection = await pool.getConnection();
        let order;
        let refundInfo = null;
        try {
            await connection.beginTransaction();
            const [rows] = await connection.query(
                `SELECT o.*, p.payment_id, p.payment_method, p.payment_status, p.transaction_code, p.amount AS paid_amount
                 FROM orders o LEFT JOIN payments p ON p.order_id = o.order_id
                 WHERE o.order_id = ? FOR UPDATE`,
                [orderId]
            );
            if (!rows.length) throw httpError(404, 'Không tìm thấy đơn hàng');
            order = rows[0];
            const current = order.order_status;

            if (!(TRANSITIONS[current] || []).includes(newStatus)) {
                throw httpError(400, `Không thể chuyển đơn từ "${STATUS_LABELS[current]}" sang "${STATUS_LABELS[newStatus]}"`);
            }
            // Đơn Stripe chưa trả tiền thì không được đưa vào xử lý
            if (['confirmed', 'processing', 'shipping'].includes(newStatus)
                && order.payment_method === 'stripe' && order.payment_status !== 'success') {
                throw httpError(400, 'Đơn thanh toán thẻ chưa được thanh toán, không thể xử lý');
            }

            // ---- Hoàn kho khi hủy / hoàn trả ----
            if (newStatus === 'cancelled' || newStatus === 'returned') {
                await restoreInventory(connection, orderId, order.branch_id);
                if (order.customer_id) {
                    // Revoke points silently if there were any
                    await LoyaltyService.revokePointsForOrder(connection, orderId).catch(console.error);
                }
            }
            
            // ---- Cộng điểm tích luỹ khi hoàn thành ----
            if (newStatus === 'completed' && order.customer_id) {
                await LoyaltyService.awardPointsForOrder(connection, orderId).catch(console.error);
            }

            // ---- Đồng bộ thanh toán ----
            if (newStatus === 'completed' && order.payment_status === 'pending') {
                await connection.query("UPDATE payments SET payment_status = 'success', paid_at = NOW() WHERE order_id = ?", [orderId]);
            }
            if (newStatus === 'cancelled' || newStatus === 'returned') {
                if (order.payment_status === 'pending') {
                    await connection.query("UPDATE payments SET payment_status = 'failed' WHERE order_id = ?", [orderId]);
                } else if (order.payment_status === 'success') {
                    if (order.payment_method === 'stripe' && order.transaction_code && order.transaction_code.startsWith('pi_')) {
                        // Hoàn tiền Stripe trước khi commit – nếu lỗi thì rollback, đơn giữ nguyên
                        await StripeService.refund(order.transaction_code);
                        refundInfo = 'Đã hoàn tiền tự động về thẻ.';
                    } else {
                        refundInfo = `Cần hoàn ${money(order.paid_amount)} cho khách (${PAYMENT_LABELS[order.payment_method] || order.payment_method}).`;
                    }
                    await connection.query("UPDATE payments SET payment_status = 'refunded' WHERE order_id = ?", [orderId]);
                    await connection.query(
                        'INSERT INTO payment_refunds (payment_id, amount, reason, status, processed_by) VALUES (?, ?, ?, ?, ?)',
                        [order.payment_id, order.paid_amount, note || `Đơn chuyển sang ${STATUS_LABELS[newStatus]}`,
                         order.payment_method === 'stripe' ? 'completed' : 'pending', accountId]
                    );
                }
            }

            await connection.query('UPDATE orders SET order_status = ? WHERE order_id = ?', [newStatus, orderId]);
            const historyNote = [note || `Chuyển sang: ${STATUS_LABELS[newStatus]}`, refundInfo].filter(Boolean).join(' – ');
            await connection.query(
                'INSERT INTO order_status_history (order_id, status, changed_by, note) VALUES (?, ?, ?, ?)',
                [orderId, newStatus, accountId, historyNote.slice(0, 255)]
            );
            if (accountId) {
                await connection.query(
                    'INSERT INTO activity_logs (account_id, action, target_table, target_id, description) VALUES (?, ?, ?, ?, ?)',
                    [accountId, 'UPDATE_ORDER_STATUS', 'orders', orderId, `${order.order_code}: ${current} → ${newStatus}`]
                );
            }
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

        if (!silent) {
            const customerMsg = {
                confirmed: 'đã được cửa hàng xác nhận',
                processing: 'đang được chuẩn bị',
                shipping: 'đang được giao đến bạn',
                completed: 'đã giao thành công. Cảm ơn bạn đã mua sắm!',
                cancelled: 'đã bị hủy',
                returned: 'đã được hoàn trả'
            }[newStatus];
            NotificationService.notifyCustomer({
                customerId: order.customer_id,
                content: `Đơn hàng ${order.order_code} ${customerMsg}.${refundInfo && order.payment_method === 'stripe' ? ' ' + refundInfo : ''}`,
                orderId
            });
        }
        emitOrdersChanged(orderId, 'STATUS');
        return { order_code: order.order_code, previous: order.order_status, status: newStatus, refund: refundInfo };
    },

    /* ------------------------------------------------------------------------
     * KHÁCH HÀNG TỰ PHỤC VỤ
     * ----------------------------------------------------------------------*/
    /** Lấy đơn theo mã + kiểm tra quyền: đơn của tài khoản thì phải đăng nhập đúng tài khoản */
    findOwnedOrder: async (orderCode, user) => {
        const [rows] = await pool.query(
            `SELECT o.*, p.payment_method, p.payment_status, p.transaction_code
             FROM orders o LEFT JOIN payments p ON p.order_id = o.order_id WHERE o.order_code = ?`,
            [orderCode]
        );
        if (!rows.length) throw httpError(404, 'Không tìm thấy đơn hàng');
        const order = rows[0];
        if (order.channel !== 'online') throw httpError(403, 'Đơn mua tại cửa hàng vui lòng liên hệ quầy để được hỗ trợ');
        if (order.customer_id) {
            const isOwner = user && user.role === 'customer' && Number(user.id) === Number(order.customer_id);
            if (!isOwner) throw httpError(403, 'Vui lòng đăng nhập đúng tài khoản đã đặt đơn này');
        }
        return order;
    },

    cancelByCustomer: async (orderCode, user, reason) => {
        const order = await OrderService.findOwnedOrder(orderCode, user);
        if (order.order_status !== 'pending') {
            throw httpError(400, 'Chỉ có thể tự hủy khi đơn hàng chưa được xác nhận. Nếu đã thanh toán hoặc xác nhận, vui lòng liên hệ hotline.');
        }
        const hours = (Date.now() - new Date(order.created_at).getTime()) / 36e5;
        if (hours > CUSTOMER_CANCEL_HOURS) {
            throw httpError(400, `Đã quá ${CUSTOMER_CANCEL_HOURS} giờ kể từ lúc đặt, không thể tự hủy. Vui lòng liên hệ hotline.`);
        }
        const result = await OrderService.updateOrderStatus(order.order_id, 'cancelled', {
            note: `Khách hàng tự hủy${reason ? `: ${String(reason).slice(0, 150)}` : ''}`
        });
        NotificationService.notifyStaff({
            content: `❌ Khách đã tự hủy đơn ${order.order_code}.${result.refund ? ' ' + result.refund : ''}`,
            orderId: order.order_id,
            type: 'ORDER_CANCELLED'
        });
        return result;
    },

    /* ------------------------------------------------------------------------
     * ĐƠN POS (BÁN TẠI QUẦY)
     * ----------------------------------------------------------------------*/
    createPOSOrder: async ({ staffId, branchId, customerId, items, paymentMethod = 'cash', promoCode, promotionId, cashReceived, note }) => {
        if (!POS_PAYMENT_METHODS.includes(paymentMethod)) throw httpError(400, 'Phương thức thanh toán không hợp lệ');
        const normalized = normalizeItems(items);
        const branch = branchId || 1;

        const connection = await pool.getConnection();
        let orderId, orderCode, total, change = 0;
        try {
            await connection.beginTransaction();

            if (customerId) {
                const [c] = await connection.query('SELECT customer_id FROM customers WHERE customer_id = ?', [customerId]);
                if (!c.length) throw httpError(400, 'Khách hàng không tồn tại');
            }

            const lines = await loadVariants(connection, normalized);
            for (const l of lines) {
                const [inv] = await connection.query(
                    'SELECT quantity FROM inventory WHERE variant_id = ? AND branch_id = ? FOR UPDATE',
                    [l.variant_id, branch]
                );
                const stock = inv.length ? Number(inv[0].quantity) : 0;
                if (stock < l.quantity) {
                    throw httpError(400, `"${l.product_name}" (${l.sku}) chỉ còn ${stock} sản phẩm tại chi nhánh`);
                }
            }
            const subtotal = lines.reduce((s, l) => s + l.unit_price * l.quantity, 0);

            let promo = null;
            if (promoCode || promotionId) {
                promo = await OrderService.evaluatePromotion(
                    { code: promoCode, promotionId, subtotal, channel: 'pos', customerId }, connection
                );
            }
            const discount = promo ? promo.discount_amount : 0;
            
            let loyaltyDiscount = 0;
            if (customerId) {
                const [cRows] = await connection.query('SELECT loyalty_points FROM customers WHERE customer_id = ?', [customerId]);
                if (cRows.length) {
                    const discountData = LoyaltyService.calcDiscount(Number(cRows[0].loyalty_points) || 0, Math.max(0, subtotal - discount));
                    loyaltyDiscount = discountData.amount;
                }
            }

            total = Math.max(0, subtotal - discount - loyaltyDiscount);

            let paymentNote = PAYMENT_LABELS[paymentMethod];
            if (paymentMethod === 'cash' && cashReceived !== undefined && cashReceived !== null && cashReceived !== '') {
                const received = Number(cashReceived);
                if (!Number.isFinite(received) || received < total) {
                    throw httpError(400, `Tiền khách đưa (${money(received)}) chưa đủ thanh toán ${money(total)}`);
                }
                change = received - total;
                paymentNote += ` – khách đưa ${money(received)}, trả lại ${money(change)}`;
            }

            orderCode = `POS-${Date.now().toString().slice(-7)}-${Math.floor(100 + Math.random() * 900)}`;
            const [orderRes] = await connection.query(
                `INSERT INTO orders (order_code, channel, customer_id, branch_id, staff_id, order_status,
                    subtotal_amount, discount_amount, loyalty_discount, shipping_fee, total_amount, note)
                 VALUES (?, 'pos', ?, ?, ?, 'completed', ?, ?, ?, 0, ?, ?)`,
                [orderCode, customerId || null, branch, staffId, subtotal, discount, loyaltyDiscount, total, note ? String(note).slice(0, 500) : null]
            );
            orderId = orderRes.insertId;

            for (const l of lines) {
                await connection.query(
                    'INSERT INTO order_items (order_id, variant_id, quantity, unit_price, line_discount) VALUES (?, ?, ?, ?, 0)',
                    [orderId, l.variant_id, l.quantity, l.unit_price]
                );
                await connection.query(
                    'UPDATE inventory SET quantity = quantity - ? WHERE variant_id = ? AND branch_id = ?',
                    [l.quantity, l.variant_id, branch]
                );
            }
            if (promo && discount > 0) {
                await connection.query(
                    'INSERT INTO order_promotions (order_id, promotion_id, discount_applied) VALUES (?, ?, ?)',
                    [orderId, promo.promotion_id, discount]
                );
            }
            await connection.query(
                'INSERT INTO order_status_history (order_id, status, changed_by, note) VALUES (?, ?, ?, ?)',
                [orderId, 'completed', staffId, `Bán tại quầy – ${paymentNote}`.slice(0, 255)]
            );
            await connection.query(
                'INSERT INTO payments (order_id, payment_method, amount, payment_status, paid_at) VALUES (?, ?, ?, ?, NOW())',
                [orderId, paymentMethod, total, 'success']
            );
            await connection.query(
                'INSERT INTO activity_logs (account_id, action, target_table, target_id, description) VALUES (?, ?, ?, ?, ?)',
                [staffId, 'CREATE_POS_ORDER', 'orders', orderId, `Tạo đơn POS ${orderCode} – ${money(total)}`]
            );
            if (customerId) {
                await LoyaltyService.awardPointsForOrder(connection, orderId).catch(console.error);
            }
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

        emitOrdersChanged(orderId, 'POS_CREATED');
        const order = await OrderService.getOrderById(orderId);
        return { ...order, orderId, orderCode, change };
    },

    /* ------------------------------------------------------------------------
     * PHÂN CÔNG ĐƠN HÀNG ONLINE
     * ----------------------------------------------------------------------*/
    getBranchSuggestions: async (orderId) => {
        const [orders] = await pool.query('SELECT shipping_latitude, shipping_longitude FROM orders WHERE order_id = ?', [orderId]);
        if (!orders.length) throw httpError(404, 'Đơn hàng không tồn tại');
        const { shipping_latitude, shipping_longitude } = orders[0];

        const [items] = await pool.query('SELECT variant_id, quantity FROM order_items WHERE order_id = ?', [orderId]);
        const variantIds = items.map(i => i.variant_id);

        let branchesQuery = 'SELECT branch_id, branch_name, address, latitude, longitude FROM branches WHERE is_active = 1';
        let branchesParams = [];
        if (shipping_latitude && shipping_longitude) {
            branchesQuery = `
                SELECT branch_id, branch_name, address, latitude, longitude,
                  (6371 * acos(LEAST(1, cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?))
                   + sin(radians(?)) * sin(radians(latitude))))) AS distance
                FROM branches WHERE is_active = 1 AND latitude IS NOT NULL AND longitude IS NOT NULL
                UNION
                SELECT branch_id, branch_name, address, latitude, longitude, 999999 AS distance
                FROM branches WHERE is_active = 1 AND (latitude IS NULL OR longitude IS NULL)
                ORDER BY distance ASC
            `;
            branchesParams = [shipping_latitude, shipping_longitude, shipping_latitude];
        }

        const [branches] = await pool.query(branchesQuery, branchesParams);

        const result = [];
        for (const b of branches) {
            let hasEnoughStock = true;
            if (variantIds.length > 0) {
                const [inv] = await pool.query(
                    'SELECT variant_id, quantity FROM inventory WHERE branch_id = ? AND variant_id IN (?)',
                    [b.branch_id, variantIds]
                );
                const stock = new Map(inv.map(r => [r.variant_id, Number(r.quantity)]));
                if (!items.every(item => (stock.get(item.variant_id) || 0) >= item.quantity)) {
                    hasEnoughStock = false;
                }
            }

            const [staff] = await pool.query('SELECT account_id, full_name, email FROM accounts WHERE branch_id = ? AND role = "staff" AND is_active = 1', [b.branch_id]);

            result.push({
                ...b,
                distance: b.distance === 999999 ? null : b.distance,
                hasEnoughStock,
                staff
            });
        }
        return result;
    },

    assignOrder: async (orderId, branchId, staffId, accountId) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [rows] = await connection.query('SELECT order_status, branch_id FROM orders WHERE order_id = ? FOR UPDATE', [orderId]);
            if (!rows.length) throw httpError(404, 'Đơn hàng không tồn tại');
            const order = rows[0];

            if (order.branch_id) {
                throw httpError(400, 'Đơn hàng đã được phân công chi nhánh');
            }
            if (order.order_status === 'cancelled' || order.order_status === 'returned') {
                throw httpError(400, 'Không thể phân công đơn hàng đã hủy hoặc hoàn trả');
            }

            // Kiểm tra tồn kho và trừ kho
            const [items] = await connection.query('SELECT i.variant_id, i.quantity, v.sku FROM order_items i JOIN product_variants v ON i.variant_id = v.variant_id WHERE i.order_id = ?', [orderId]);
            
            for (const item of items) {
                const [inv] = await connection.query(
                    'SELECT quantity FROM inventory WHERE variant_id = ? AND branch_id = ? FOR UPDATE',
                    [item.variant_id, branchId]
                );
                const stock = inv.length ? Number(inv[0].quantity) : 0;
                if (stock < item.quantity) {
                    throw httpError(400, `Sản phẩm SKU ${item.sku} không đủ tồn kho tại chi nhánh này (Chỉ còn ${stock})`);
                }
                await connection.query(
                    'UPDATE inventory SET quantity = quantity - ? WHERE variant_id = ? AND branch_id = ?',
                    [item.quantity, item.variant_id, branchId]
                );
            }

            await connection.query(
                'UPDATE orders SET branch_id = ?, staff_id = ? WHERE order_id = ?',
                [branchId, staffId, orderId]
            );

            await connection.query(
                'INSERT INTO order_status_history (order_id, status, changed_by, note) VALUES (?, ?, ?, ?)',
                [orderId, order.order_status, accountId, 'Admin phân công đơn hàng cho chi nhánh và nhân viên']
            );

            if (accountId) {
                await connection.query(
                    'INSERT INTO activity_logs (account_id, action, target_table, target_id, description) VALUES (?, ?, ?, ?, ?)',
                    [accountId, 'ASSIGN_ORDER', 'orders', orderId, `Phân công đơn hàng cho branch ${branchId}, staff ${staffId}`]
                );
            }

            await connection.commit();

            // Thông báo cho nhân viên được gán
            if (staffId) {
                const io = getIO();
                if (io) {
                    io.to(`account_${staffId}`).emit('new_notification', {
                        notif_type: 'order_assigned',
                        content: `Bạn vừa được phân công xử lý một đơn hàng mới.`,
                        created_at: new Date()
                    });
                }
            }
            emitOrdersChanged(orderId, 'ASSIGNED');
            
            return true;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    },
    /* ------------------------------------------------------------------------
     * TRUY VẤN
     * ----------------------------------------------------------------------*/
    listOrders: async ({ page = 1, limit = 10, status, channel, payment_status, search, date_from, date_to, branch_id } = {}) => {
        const where = [];
        const params = [];
        if (channel && ['online', 'pos'].includes(channel)) { where.push('o.channel = ?'); params.push(channel); }
        if (payment_status) { where.push('p.payment_status = ?'); params.push(payment_status); }
        if (branch_id) { where.push('o.branch_id = ?'); params.push(branch_id); }
        if (date_from) { where.push('o.created_at >= ?'); params.push(`${date_from} 00:00:00`); }
        if (date_to) { where.push('o.created_at <= ?'); params.push(`${date_to} 23:59:59`); }
        if (search && String(search).trim()) {
            const kw = `%${String(search).trim()}%`;
            where.push('(o.order_code LIKE ? OR c.full_name LIKE ? OR c.phone LIKE ? OR o.shipping_address_snapshot LIKE ?)');
            params.push(kw, kw, kw, kw);
        }
        const baseFrom = `FROM orders o
            LEFT JOIN customers c ON o.customer_id = c.customer_id
            LEFT JOIN payments p ON o.order_id = p.order_id
            LEFT JOIN accounts a ON o.staff_id = a.account_id
            LEFT JOIN branches b ON o.branch_id = b.branch_id`;

        // Đếm theo trạng thái (cho các tab) – áp dụng các bộ lọc khác trừ status
        const baseWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const [countRows] = await pool.query(
            `SELECT o.order_status, COUNT(*) AS cnt ${baseFrom} ${baseWhere} GROUP BY o.order_status`, params
        );
        const counts = { all: 0 };
        countRows.forEach(r => { counts[r.order_status] = Number(r.cnt); counts.all += Number(r.cnt); });

        const statusList = status ? String(status).split(',').filter(s => STATUS_LABELS[s]) : [];
        const fullWhere = [...where];
        const fullParams = [...params];
        if (statusList.length) { fullWhere.push('o.order_status IN (?)'); fullParams.push(statusList); }
        const whereSql = fullWhere.length ? `WHERE ${fullWhere.join(' AND ')}` : '';

        const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${baseFrom} ${whereSql}`, fullParams);
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const size = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));

        const [items] = await pool.query(
            `SELECT o.order_id, o.order_code, o.channel, o.order_status, o.subtotal_amount, o.discount_amount,
                    o.shipping_fee, o.total_amount, o.created_at, o.shipping_address_snapshot, o.customer_id,
                    c.full_name AS customer_name, c.phone AS customer_phone,
                    a.full_name AS staff_name, b.branch_name,
                    p.payment_method, p.payment_status,
                    (SELECT COALESCE(SUM(quantity),0) FROM order_items oi WHERE oi.order_id = o.order_id) AS total_items
             ${baseFrom} ${whereSql}
             ORDER BY o.created_at DESC, o.order_id DESC
             LIMIT ? OFFSET ?`,
            [...fullParams, size, (pageNum - 1) * size]
        );
        const formattedItems = items.map(o => {
            let name = o.customer_name;
            if (!name && o.shipping_address_snapshot) {
                const match = o.shipping_address_snapshot.match(/Tên:\s*([^,]+)/);
                if (match && match[1]) name = match[1].trim();
            }
            return { ...o, customer_name: name };
        });

        return {
            items: formattedItems,
            counts,
            pagination: { page: pageNum, limit: size, total: Number(total), totalPages: Math.max(1, Math.ceil(Number(total) / size)) }
        };
    },

    getOrderById: async (orderId) => {
        const [orders] = await pool.query(
            `SELECT o.*, c.full_name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
                    a.full_name AS staff_name, b.branch_name,
                    p.payment_method, p.payment_status, p.transaction_code, p.paid_at,
                    (SELECT pr.promo_code FROM order_promotions op JOIN promotions pr ON pr.promotion_id = op.promotion_id
                      WHERE op.order_id = o.order_id LIMIT 1) AS promo_code
             FROM orders o
             LEFT JOIN customers c ON o.customer_id = c.customer_id
             LEFT JOIN accounts a ON o.staff_id = a.account_id
             LEFT JOIN branches b ON o.branch_id = b.branch_id
             LEFT JOIN payments p ON p.order_id = o.order_id
             WHERE o.order_id = ?`,
            [orderId]
        );
        if (!orders.length) return null;
        const order = orders[0];
        
        if (!order.customer_name && order.shipping_address_snapshot) {
            const match = order.shipping_address_snapshot.match(/Tên:\s*([^,]+)/);
            if (match && match[1]) order.customer_name = match[1].trim();
        }

        const [items] = await pool.query(
            `SELECT oi.*, oi.order_item_id AS item_id, v.sku, p.product_id, p.product_name, s.size_value, col.color_name, col.hex_code,
                    COALESCE(
                      (SELECT image_url FROM product_images pi WHERE pi.variant_id = v.variant_id ORDER BY pi.sort_order LIMIT 1),
                      (SELECT image_url FROM product_images pi WHERE pi.product_id = p.product_id ORDER BY pi.is_primary DESC, pi.sort_order LIMIT 1)
                    ) AS image_url
             FROM order_items oi
             JOIN product_variants v ON oi.variant_id = v.variant_id
             JOIN products p ON v.product_id = p.product_id
             LEFT JOIN sizes s ON v.size_id = s.size_id
             LEFT JOIN colors col ON v.color_id = col.color_id
             WHERE oi.order_id = ?`,
            [orderId]
        );
        const [history] = await pool.query(
            `SELECT h.*, a.full_name AS changed_by_name FROM order_status_history h
             LEFT JOIN accounts a ON h.changed_by = a.account_id
             WHERE h.order_id = ? ORDER BY h.changed_at ASC, h.history_id ASC`,
            [orderId]
        );
        order.items = items;
        order.history = history;
        order.allowed_transitions = TRANSITIONS[order.order_status] || [];
        order.can_customer_cancel = order.channel === 'online'
            && ['pending', 'confirmed'].includes(order.order_status)
            && (Date.now() - new Date(order.created_at).getTime()) / 36e5 <= CUSTOMER_CANCEL_HOURS;
        order.awaiting_payment = order.payment_method === 'stripe' && order.payment_status === 'pending' && order.order_status === 'pending';
        // Không lộ mã giao dịch ra ngoài
        delete order.transaction_code;
        return order;
    },

    getOrderByCode: async (orderCode) => {
        const [rows] = await pool.query('SELECT order_id FROM orders WHERE order_code = ?', [orderCode]);
        if (!rows.length) return null;
        return OrderService.getOrderById(rows[0].order_id);
    },

    deleteOrder: async (orderId, adminId) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [orders] = await connection.query('SELECT order_code FROM orders WHERE order_id = ?', [orderId]);
            if (!orders.length) throw httpError(404, 'Đơn hàng không tồn tại');
            const orderCode = orders[0].order_code;

            // Xóa các bảng phụ trước
            await connection.query('DELETE FROM order_items WHERE order_id = ?', [orderId]);
            await connection.query('DELETE FROM order_status_history WHERE order_id = ?', [orderId]);
            await connection.query('DELETE FROM payments WHERE order_id = ?', [orderId]);
            await connection.query('DELETE FROM order_promotions WHERE order_id = ?', [orderId]);

            // Xóa đơn hàng
            await connection.query('DELETE FROM orders WHERE order_id = ?', [orderId]);

            // Lưu log
            await connection.query(
                'INSERT INTO activity_logs (account_id, action, target_table, target_id, description) VALUES (?, ?, ?, ?, ?)',
                [adminId, 'DELETE_ORDER', 'orders', orderId, `Xóa đơn hàng ${orderCode}`]
            );

            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    },

    getBranchSuggestions: async (orderId) => {
        const [orders] = await pool.query('SELECT shipping_latitude, shipping_longitude FROM orders WHERE order_id = ?', [orderId]);
        if (!orders.length) throw { statusCode: 404, message: 'Đơn hàng không tồn tại' };
        const order = orders[0];
        
        const [branches] = await pool.query('SELECT branch_id, branch_name, address, latitude, longitude FROM branches WHERE is_active = 1');
        
        const R = 6371; 
        const deg2rad = (deg) => deg * (Math.PI / 180);
        
        const suggestions = branches.map(b => {
            let distance = null;
            if (order.shipping_latitude && order.shipping_longitude && b.latitude && b.longitude) {
                const dLat = deg2rad(b.latitude - order.shipping_latitude);
                const dLon = deg2rad(b.longitude - order.shipping_longitude);
                const a = 
                    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(deg2rad(order.shipping_latitude)) * Math.cos(deg2rad(b.latitude)) * 
                    Math.sin(dLon / 2) * Math.sin(dLon / 2); 
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); 
                distance = R * c; 
            }
            return {
                ...b,
                distance,
                hasEnoughStock: true
            };
        });
        
        suggestions.sort((a, b) => {
            if (a.distance === null) return 1;
            if (b.distance === null) return -1;
            return a.distance - b.distance;
        });
        
        for (let i = 0; i < suggestions.length; i++) {
            const [staffs] = await pool.query('SELECT account_id, full_name FROM accounts WHERE branch_id = ? AND is_active = 1 AND role_id = 2', [suggestions[i].branch_id]);
            suggestions[i].staff = staffs;
        }

        return suggestions;
    },

    assignOrder: async (orderId, branchId, staffId, adminId) => {
        const [order] = await pool.query('SELECT order_status FROM orders WHERE order_id = ?', [orderId]);
        if (!order.length) throw { statusCode: 404, message: 'Đơn hàng không tồn tại' };
        
        let updates = [];
        let params = [];
        if (branchId !== undefined) {
            updates.push('branch_id = ?');
            params.push(branchId || null);
        }
        if (staffId !== undefined) {
            updates.push('staff_id = ?');
            params.push(staffId || null);
        }
        
        if (updates.length > 0) {
            params.push(orderId);
            await pool.query(`UPDATE orders SET ${updates.join(', ')} WHERE order_id = ?`, params);
            
            await pool.query(
                'INSERT INTO order_status_history (order_id, status, note, changed_by) VALUES (?, ?, ?, ?)',
                [orderId, order[0].order_status, `Phân đơn: branch_id=${branchId || 'trống'}, staff_id=${staffId || 'trống'}`, adminId]
            );

            if (staffId) {
                await NotificationService.notifySingleStaff({
                    accountId: staffId,
                    content: `Bạn có đơn đặt hàng mới cần xử lý (Mã: ${orderId})`,
                    orderId: orderId,
                    type: 'ORDER_ASSIGNED'
                });
            }
        }
        return true;
    }
};

module.exports = OrderService;
