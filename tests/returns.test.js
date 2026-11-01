const { test } = require('node:test');
const assert = require('node:assert/strict');
let statements;
let committed;
let rolledBack;
let released;
const connection = {
  beginTransaction: async () => {},
  query: async (sql, params) => {
    statements.push({ sql, params });
    if (sql.startsWith('SELECT order_status')) return [[{ order_status: 'completed', customer_id: 1 }]];
    if (sql.startsWith('SELECT quantity')) return [[{ quantity: 2 }]];
    if (sql.includes('COALESCE(SUM(ri.quantity)')) return [[{ quantity: 1 }]];
    return [{ insertId: 10 }];
  },
  commit: async () => { committed = true; },
  rollback: async () => { rolledBack = true; },
  release: () => { released = true; }
};
const filename = require.resolve('../src/config/database');
require.cache[filename] = { id: filename, filename, loaded: true, exports: { getConnection: async () => connection } };
const model = require('../src/models/returnModel');
const request = () => ({ order_id: 2, return_type: 'return', reason: 'Damaged item', actor: { id: 1, role: 'customer' }, items: [{ order_item_id: 8, quantity: 1 }] });
function reset() { statements = []; committed = false; rolledBack = false; released = false; }
test('another customer cannot return an order', async () => {
  reset(); const data = request(); data.actor.id = 9;
  await assert.rejects(model.createReturnRequest(data));
  assert.ok(rolledBack && released && !committed);
  assert.ok(!statements.some(s => s.sql.startsWith('INSERT')));
});
test('outstanding requests count against the purchased quantity', async () => {
  reset(); const data = request(); data.items[0].quantity = 2;
  await assert.rejects(model.createReturnRequest(data));
  assert.ok(rolledBack && released && !committed);
});
test('duplicate lines cannot bypass return quantity limits', async () => {
  reset(); const data = request(); data.items.push({ ...data.items[0] });
  await assert.rejects(model.createReturnRequest(data));
  assert.ok(rolledBack && released && !committed);
});
test('a valid partial return commits and notifies actual admin recipients', async () => {
  reset(); assert.equal(await model.createReturnRequest(request()), 10);
  const notice = statements.find(s => s.sql.includes('INSERT INTO notifications'));
  assert.ok(notice.sql.includes('account_id'));
  assert.ok(committed && released && !rolledBack);
});
