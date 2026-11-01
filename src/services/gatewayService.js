const crypto = require('node:crypto');
const error = (message) => Object.assign(new Error(message), { statusCode: 400 });
const required = (keys) => {
    if (keys.some(key => !process.env[key])) throw error('Cổng thanh toán chưa được cấu hình');
};
const digest = (algorithm, secret, value) => crypto.createHmac(algorithm, secret).update(value, 'utf8').digest('hex');
const sameSignature = (actual, expected) => typeof actual === 'string' && /^[a-fA-F0-9]+$/.test(actual) && actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual.toLowerCase()), Buffer.from(expected));
const encode = value => encodeURIComponent(String(value)).replace(/%20/g, '+').replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const vnpayData = params => Object.keys(params).filter(key => key.startsWith('vnp_') && !['vnp_SecureHash', 'vnp_SecureHashType'].includes(key)).sort().map(key => `${encode(key)}=${encode(params[key])}`).join('&');
const momoData = (params, keys) => keys.map(key => `${key}=${params[key] ?? ''}`).join('&');
const dateString = date => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
};
const available = () => ({
    vnpay: Boolean(process.env.VNPAY_TMN_CODE && process.env.VNPAY_HASH_SECRET && process.env.PUBLIC_API_URL),
    momo: Boolean(process.env.MOMO_PARTNER_CODE && process.env.MOMO_ACCESS_KEY && process.env.MOMO_SECRET_KEY && process.env.PUBLIC_API_URL),
    stripe: Boolean(process.env.STRIPE_SECRET_KEY)
});
const createPayment = async ({ method, orderCode, amount, frontendUrl, ipAddress }) => {
    if (!available()[method]) throw error('Cổng thanh toán chưa được cấu hình');
    const api = process.env.PUBLIC_API_URL.replace(/\/$/, '');
    const trackingUrl = `${frontendUrl}/store/tracking?code=${encodeURIComponent(orderCode)}`;
    if (method === 'vnpay') {
        const params = {
            vnp_Version: '2.1.0', vnp_Command: 'pay', vnp_TmnCode: process.env.VNPAY_TMN_CODE,
            vnp_Amount: Math.round(Number(amount) * 100), vnp_CurrCode: 'VND', vnp_TxnRef: orderCode,
            vnp_OrderInfo: `Thanh toan don hang ${orderCode}`, vnp_OrderType: 'other', vnp_Locale: 'vn',
            vnp_ReturnUrl: trackingUrl, vnp_IpAddr: ipAddress || '127.0.0.1',
            vnp_CreateDate: dateString(new Date()), vnp_ExpireDate: dateString(new Date(Date.now() + 15 * 60000))
        };
        const data = vnpayData(params);
        return `${process.env.VNPAY_PAYMENT_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'}?${data}&vnp_SecureHash=${digest('sha512', process.env.VNPAY_HASH_SECRET, data)}`;
    }
    if (method !== 'momo') throw error('Cổng thanh toán không hợp lệ');
    if (!Number.isSafeInteger(Number(amount)) || Number(amount) < 1000 || Number(amount) > 50000000) throw error('MoMo hỗ trợ số tiền từ 1.000 đến 50.000.000 đồng');
    const payload = {
        partnerCode: process.env.MOMO_PARTNER_CODE, requestId: crypto.randomUUID(), orderId: orderCode,
        amount: Math.round(Number(amount)), orderInfo: `Thanh toan don hang ${orderCode}`,
        redirectUrl: trackingUrl, ipnUrl: `${api}/api/payments/momo/ipn`, requestType: 'captureWallet', extraData: '', lang: 'vi', autoCapture: true
    };
    payload.signature = digest('sha256', process.env.MOMO_SECRET_KEY, momoData({ accessKey: process.env.MOMO_ACCESS_KEY, ...payload }, ['accessKey', 'amount', 'extraData', 'ipnUrl', 'orderId', 'orderInfo', 'partnerCode', 'redirectUrl', 'requestId', 'requestType']));
    const response = await fetch(process.env.MOMO_CREATE_URL || 'https://test-payment.momo.vn/v2/gateway/api/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(35000) });
    if (!response.ok) throw error('Không kết nối được cổng MoMo');
    const result = await response.json();
    if (Number(result.resultCode) !== 0 || !result.payUrl) throw error('MoMo chưa tạo được phiên thanh toán. Vui lòng thử lại');
    const target = new URL(result.payUrl);
    if (target.protocol !== 'https:' || !['test-payment.momo.vn', 'payment.momo.vn'].includes(target.hostname)) throw error('Liên kết MoMo không hợp lệ');
    return result.payUrl;
};
const verifyVnpay = params => {
    required(['VNPAY_TMN_CODE', 'VNPAY_HASH_SECRET']);
    if (Object.values(params).some(value => typeof value !== 'string')) return false;
    return params.vnp_TmnCode === process.env.VNPAY_TMN_CODE && sameSignature(params.vnp_SecureHash, digest('sha512', process.env.VNPAY_HASH_SECRET, vnpayData(params)));
};
const verifyMomo = params => {
    required(['MOMO_PARTNER_CODE', 'MOMO_ACCESS_KEY', 'MOMO_SECRET_KEY']);
    if (!params || Object.values(params).some(value => value != null && typeof value === 'object')) return false;
    const keys = ['accessKey', 'amount', 'extraData', 'message', 'orderId', 'orderInfo', 'orderType', 'partnerCode', 'payType', 'requestId', 'responseTime', 'resultCode', 'transId'];
    return params.partnerCode === process.env.MOMO_PARTNER_CODE && sameSignature(params.signature, digest('sha256', process.env.MOMO_SECRET_KEY, momoData({ ...params, accessKey: process.env.MOMO_ACCESS_KEY }, keys)));
};
module.exports = { available, createPayment, verifyVnpay, verifyMomo };
