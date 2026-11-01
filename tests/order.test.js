const { test } = require('node:test');
const assert = require('node:assert/strict');
const mockModule = (relative, exports) => {
  const filename = require.resolve(relative);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
let stock = 8;
let staff = true;
let statements;
let committed;
let rollback;
let released;
const connection = {
  beginTransaction: async () => {},
  query: async (sql, args) => {
    statements.push({ sql, args });
    if (sql.includes('SELECT order_status, branch_id')) return [[{ order_status: 'confirmed', branch_id: null }]];
    if (sql.includes('SELECT a.account_id')) return [[...(staff ? [{ account_id: 5 }] : [])]];
    if (sql.includes('SELECT i.variant_id')) return [[{ variant_id: 9, quantity: 3, sku: 'SKU-9' }]];
    if (sql.includes('SELECT quantity FROM inventory')) return [[{ quantity: stock }]];
    return [{ affectedRows: 1 }];
  },
  commit: async () => { committed = true; },
  rollback: async () => { rollback = true; },
  release: () => { released = true; }
};
mockModule('../src/config/database', { getConnection: async () => connection });
mockModule('../src/services/stripeService', {});
mockModule('../src/services/notificationService', { notifySingleStaff: async () => {} });
mockModule('../src/services/loyaltyService', {});
mockModule('../src/config/socket', { getIO: () => null, ROOMS: { STAFF: 'staff_room' } });
const service = require('../src/services/orderService');
function reset() { statements = []; committed = false; rollback = false; released = false; stock = 8; staff = true; }
test('assignment locks and reserves stock in the same transaction as order and audit history', async () => {
  reset();
  await service.assignOrder(1, 2, 5, 7);
  assert.ok(statements.some(s => s.sql.includes('inventory') && s.sql.includes('FOR UPDATE')));
  const reserve = statements.find(s => s.sql.startsWith('UPDATE inventory'));
  assert.deepEqual(reserve.args, [3, 9, 2]);
  assert.ok(statements.some(s => s.sql.includes('INSERT INTO activity_logs')));
  assert.ok(committed && released && !rollback);
});
test('assignment rolls back on insufficient stock without updating order or inventory', async () => {
  reset(); stock = 1;
  await assert.rejects(service.assignOrder(1, 2, 5, 7), error => error.statusCode === 400);
  assert.ok(rollback && released && !committed);
  assert.ok(!statements.some(s => s.sql.startsWith('UPDATE')));
});
test('assignment rejects an inactive staff member or a staff member from a different branch', async () => {
  reset(); staff = false;
  await assert.rejects(service.assignOrder(1, 2, 5, 7), error => error.statusCode === 400);
  assert.ok(rollback && released && !committed);
});
