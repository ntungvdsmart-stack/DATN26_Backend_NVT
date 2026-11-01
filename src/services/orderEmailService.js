const { sendBrandedEmail } = require('../utils/mailHelper');
const { orderUpdate } = require('../utils/emailTemplates');

// Invoke only after the order transaction commits. Delivery failures never undo an order.
async function sendOrderEmail(orderId, status) {
    try {
        const order = await require('./orderService').getOrderById(orderId);
        if (!order || order.channel !== 'online' || !order.customer_email) return false;
        return await sendBrandedEmail(order.customer_email, brand => orderUpdate(brand, order, order.items || [], status), {
            idempotencyKey: `order-${orderId}-${status}`
        });
    } catch { console.error('[email] Could not prepare order notification'); return false; }
}
module.exports = { sendOrderEmail };
