const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Phiên Stripe Checkout tồn tại tối thiểu 30 phút (giới hạn của Stripe)
const SESSION_TTL_MINUTES = 30;

/**
 * Lớp bọc thuần Stripe API (không đụng DB) để tránh vòng lặp require
 * giữa OrderService và StripeController.
 */
const StripeService = {
    SESSION_TTL_MINUTES,

    createCheckoutSession: async ({ orderId, orderCode, totalAmount, customerEmail, frontendUrl }) => {
        const amount = Math.round(Number(totalAmount));
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error('Số tiền thanh toán không hợp lệ');
        }
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            customer_email: customerEmail || undefined,
            line_items: [{
                price_data: {
                    currency: 'vnd',
                    product_data: { name: `Thanh toán đơn hàng #${orderCode}` },
                    unit_amount: amount
                },
                quantity: 1
            }],
            mode: 'payment',
            expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_MINUTES * 60,
            success_url: `${frontendUrl}/store/tracking?code=${orderCode}&payment=success`,
            cancel_url: `${frontendUrl}/store/tracking?code=${orderCode}&payment=cancel`,
            metadata: { orderId: String(orderId), orderCode }
        });
        return session;
    },

    retrieveSession: (sessionId) => stripe.checkout.sessions.retrieve(sessionId),

    expireSession: async (sessionId) => {
        try { await stripe.checkout.sessions.expire(sessionId); } catch (_) { /* đã hết hạn / đã trả */ }
    },

    refund: async (paymentIntentId, amount) => {
        return stripe.refunds.create({
            payment_intent: paymentIntentId,
            ...(amount ? { amount: Math.round(Number(amount)) } : {})
        });
    },

    constructWebhookEvent: (rawBody, signature) =>
        stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET)
};

module.exports = StripeService;
