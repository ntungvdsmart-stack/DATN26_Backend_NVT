const OrderService = require('../services/orderService');
const StripeService = require('../services/stripeService');

module.exports = {
  handleWebhook: async (req, res, next) => {
    let event;
    try { event = StripeService.constructWebhookEvent(req.body, req.headers['stripe-signature']); }
    catch { return res.status(400).json({ success: false, message: 'Invalid webhook signature' }); }
    try {
      if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
        const session = event.data.object;
        if (session.payment_status === 'paid' && session.metadata?.orderId) {
          await OrderService.syncStripeSession(Number(session.metadata.orderId), session.id);
        }
      }
      res.json({ received: true });
    } catch (error) { next(error); }
  },
  verifyPayment: async (req, res, next) => {
    try {
      if (typeof req.body.orderCode !== 'string') return res.status(400).json({ success: false, message: 'Order code required' });
      const state = await OrderService.verifyStripeByOrderCode(req.body.orderCode);
      res.json({ success: state === 'paid', data: { state } });
    } catch (error) { next(error); }
  }
};
