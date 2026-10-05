const pool = require('../config/database');

/* ============================================================================
 * CHƯƠNG TRÌNH KHÁCH HÀNG THÂN THIẾT
 * ----------------------------------------------------------------------------
 *  - Tích điểm: mỗi 10.000đ thanh toán thực tế (sau giảm giá, không gồm phí ship)
 *    của đơn ĐÃ HOÀN THÀNH = 1 điểm.
 *  - Hạng thành viên xác định theo tổng điểm tích lũy. Hạng càng cao → giảm giá
 *    tự động càng nhiều cho MỌI đơn (POS và Online), cộng dồn với mã khuyến mãi
 *    (tính trên số tiền SAU khi trừ mã khuyến mãi).
 *  - Đơn bị hoàn trả → thu hồi số điểm đã cộng của đơn đó.
 *  - Tất cả tính toán đều ở server – frontend chỉ hiển thị.
 * ==========================================================================*/
const VND_PER_POINT = 10000;

const TIERS = [
    { key: 'member',  name: 'Thành viên', min_points: 0,    discount_percent: 0,  color: '#64748b' },
    { key: 'bronze',  name: 'Đồng',       min_points: 100,  discount_percent: 2,  color: '#b45309' },
    { key: 'silver',  name: 'Bạc',        min_points: 500,  discount_percent: 5,  color: '#64748b' },
    { key: 'gold',    name: 'Vàng',       min_points: 1500, discount_percent: 8,  color: '#ca8a04' },
    { key: 'diamond', name: 'Kim cương',  min_points: 3000, discount_percent: 12, color: '#0891b2' }
];

const getTier = (points = 0) => {
    const p = Number(points) || 0;
    let tier = TIERS[0];
    for (const t of TIERS) if (p >= t.min_points) tier = t;
    return tier;
};

const getNextTier = (points = 0) => TIERS.find(t => t.min_points > (Number(points) || 0)) || null;

const pointsFromAmount = (amount) => Math.max(0, Math.floor((Number(amount) || 0) / VND_PER_POINT));

/** Tiền giảm theo hạng trên 1 số tiền gốc (làm tròn xuống tới đồng) */
const calcDiscount = (points, baseAmount) => {
    const tier = getTier(points);
    const base = Math.max(0, Number(baseAmount) || 0);
    return { tier, amount: Math.floor((base * tier.discount_percent) / 100) };
};

const buildLoyaltyInfo = (points) => {
    const tier = getTier(points);
    const next = getNextTier(points);
    return {
        points: Number(points) || 0,
        tier,
        next_tier: next,
        points_to_next: next ? next.min_points - (Number(points) || 0) : 0,
        vnd_per_point: VND_PER_POINT
    };
};

const LoyaltyService = {
    TIERS,
    VND_PER_POINT,
    getTier,
    getNextTier,
    pointsFromAmount,
    calcDiscount,
    buildLoyaltyInfo,

    /** Lấy thông tin khách + điểm + hạng (trong transaction có thể khóa dòng) */
    getCustomerLoyalty: async (customerId, conn = pool, { lock = false } = {}) => {
        if (!customerId) return null;
        const [rows] = await conn.query(
            `SELECT customer_id, full_name, phone, email, customer_type, loyalty_points, is_active
             FROM customers WHERE customer_id = ? ${lock ? 'FOR UPDATE' : ''}`,
            [customerId]
        );
        if (!rows.length) return null;
        const c = rows[0];
        return { ...c, ...buildLoyaltyInfo(c.loyalty_points) };
    },

    /**
     * Cộng điểm cho đơn vừa HOÀN THÀNH (idempotent: đơn đã có points_earned > 0 thì bỏ qua).
     * Phải gọi trong cùng transaction với việc chuyển trạng thái.
     */
    awardPointsForOrder: async (conn, orderId) => {
        const [rows] = await conn.query(
            'SELECT customer_id, total_amount, shipping_fee, points_earned FROM orders WHERE order_id = ?',
            [orderId]
        );
        const o = rows[0];
        if (!o || !o.customer_id || Number(o.points_earned) > 0) return 0;
        const points = pointsFromAmount(Number(o.total_amount) - Number(o.shipping_fee || 0));
        if (points <= 0) return 0;
        await conn.query('UPDATE orders SET points_earned = ? WHERE order_id = ?', [points, orderId]);
        await conn.query('UPDATE customers SET loyalty_points = loyalty_points + ? WHERE customer_id = ?', [points, o.customer_id]);
        return points;
    },

    /** Thu hồi điểm khi đơn đã hoàn thành bị hoàn trả */
    revokePointsForOrder: async (conn, orderId) => {
        const [rows] = await conn.query('SELECT customer_id, points_earned FROM orders WHERE order_id = ?', [orderId]);
        const o = rows[0];
        if (!o || !o.customer_id || Number(o.points_earned) <= 0) return 0;
        await conn.query(
            'UPDATE customers SET loyalty_points = GREATEST(0, loyalty_points - ?) WHERE customer_id = ?',
            [o.points_earned, o.customer_id]
        );
        await conn.query('UPDATE orders SET points_earned = 0 WHERE order_id = ?', [orderId]);
        return Number(o.points_earned);
    }
};

module.exports = LoyaltyService;
