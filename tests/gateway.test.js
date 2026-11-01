const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
process.env.VNPAY_TMN_CODE = 'TESTMERCHANT';
process.env.VNPAY_HASH_SECRET = 'test-only-secret';
process.env.MOMO_PARTNER_CODE = 'TESTPARTNER';
process.env.MOMO_ACCESS_KEY = 'test-access';
process.env.MOMO_SECRET_KEY = 'test-momo-secret';
process.env.PUBLIC_API_URL = 'https://shop.example';
const gateway = require('../src/services/gatewayService');
test('VNPay payment URL signs the amount in provider units and uses Vietnam time', async () => {
  const url = new URL(await gateway.createPayment({ method: 'vnpay', orderCode: 'ORD-123', amount: 250000, frontendUrl: 'https://shop.example', ipAddress: '127.0.0.1' }));
  assert.equal(url.searchParams.get('vnp_Amount'), '25000000');
  assert.match(url.searchParams.get('vnp_CreateDate'), /^\d{14}$/);
  const params = Object.fromEntries(url.searchParams);
  assert.ok(gateway.verifyVnpay(params));
  params.vnp_Amount = '100';
  assert.equal(gateway.verifyVnpay(params), false);
});
test('VNPay rejects wrong merchant, missing signatures and structured query parameters', () => {
  assert.equal(gateway.verifyVnpay({ vnp_TmnCode: 'OTHER' }), false);
  assert.equal(gateway.verifyVnpay({ vnp_TmnCode: 'TESTMERCHANT', vnp_Amount: ['100', '200'] }), false);
});
test('MoMo callback signature binds amount, status, merchant and transaction', () => {
  const params = { amount: 250000, extraData: '', message: 'Successful.', orderId: 'ORD-123', orderInfo: 'Payment', orderType: 'momo_wallet', partnerCode: 'TESTPARTNER', payType: 'qr', requestId: 'request1', responseTime: 123456, resultCode: 0, transId: 999 };
  const raw = 'accessKey=test-access&amount=250000&extraData=&message=Successful.&orderId=ORD-123&orderInfo=Payment&orderType=momo_wallet&partnerCode=TESTPARTNER&payType=qr&requestId=request1&responseTime=123456&resultCode=0&transId=999';
  params.signature = crypto.createHmac('sha256', 'test-momo-secret').update(raw).digest('hex');
  assert.ok(gateway.verifyMomo(params));
  assert.equal(gateway.verifyMomo({ ...params, resultCode: 1 }), false);
  assert.equal(gateway.verifyMomo({ ...params, amount: 1 }), false);
  assert.equal(gateway.verifyMomo({ ...params, partnerCode: 'OTHER' }), false);
});
