// Read-only checks against the configured local database. Starts an isolated API process.
require('dotenv').config();
const { spawn } = require('node:child_process');
const pool = require('../src/config/database');
const { generateToken } = require('../src/utils/jwtHelper');
const assert = require('node:assert/strict');
const port = 5091;
(async () => {
  const [[admin]] = await pool.query('SELECT account_id FROM accounts WHERE role_id = 1 AND is_active = 1 LIMIT 1');
  assert.ok(admin, 'Read-only smoke checks require an active admin');
  const token = generateToken({ id: admin.account_id, role: 'admin' });
  const child = spawn(process.execPath, ['server.js'], { cwd: require('node:path').resolve(__dirname, '..'), env: { ...process.env, PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('API startup timed out')), 60000);
      child.stdout.on('data', data => { if (data.toString().includes(`port ${port}`)) { clearTimeout(timer); resolve(); } });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`API exited before ready (${code})`)); });
    });
    for (const endpoint of ['/products', '/products/attributes/all', '/inventory', '/activity-logs', '/returns', '/support/sessions', '/stats/kpi', '/stats/revenue', '/stats/top-products', '/stats/category', '/stats/payments', '/stats/channel', '/orders/admin', '/payments/methods', '/payments/refunds']) {
      const response = await fetch(`http://127.0.0.1:${port}/api${endpoint}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200, endpoint);
      const body = await response.json();
      assert.equal(body.success, true, endpoint);
      if (endpoint === '/inventory') assert.ok(body.data.inventory.every(item => item.product_id != null), 'Inventory rows must identify their product');
      console.log(`PASS ${endpoint}`);
    }
    const denied = await fetch(`http://127.0.0.1:${port}/api/inventory`);
    assert.equal(denied.status, 401);
    console.log('PASS unauthenticated requests denied');
    const missing = await fetch(`http://127.0.0.1:${port}/api/does-not-exist`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).success, false);
    console.log('PASS unknown API returns JSON 404');
  } finally { child.kill(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
