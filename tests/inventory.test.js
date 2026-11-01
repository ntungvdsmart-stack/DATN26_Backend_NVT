const { test } = require('node:test');
const assert = require('node:assert/strict');
const databasePath = require.resolve('../src/config/database');
let queries;
let committed;
let rolledBack;
let released;
const connection = {
    beginTransaction: async () => {},
    query: async (sql, params) => {
        queries.push({ sql, params });
        if (sql.startsWith('SELECT')) return [[{ inventory_id: 1, branch_id: 2, quantity: 7 }]];
        return [{ affectedRows: 1 }];
    },
    commit: async () => { committed = true; },
    rollback: async () => { rolledBack = true; },
    release: () => { released = true; }
};
require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: { getConnection: async () => connection } };
const controller = require('../src/controllers/inventoryController');
async function update(body, user = { id: 3, role: 'staff', branch_id: 2 }) {
    queries = []; committed = false; rolledBack = false; released = false;
    const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await controller.updateInventory({ params: { inventory_id: 1 }, body, user, ip: '127.0.0.1' }, res, error => { throw error; });
    return res;
}
test('rejects fractional, missing and non-finite quantities before acquiring a connection', async () => {
    for (const quantity of [undefined, null, true, {}, [], '', ' ', -1, 1.5, 'abc', Infinity, 2147483648]) {
        assert.equal((await update({ quantity, reason: 'Count' })).statusCode, 400);
        assert.equal(queries.length, 0);
    }
});
test('staff cannot modify another branch', async () => {
    const res = await update({ quantity: 8, reason: 'Count' }, { id: 3, role: 'staff', branch_id: 9 });
    assert.equal(res.statusCode, 403);
    assert.ok(rolledBack && released && !committed);
    assert.equal(queries.length, 1);
});
test('stale stock cannot overwrite a concurrent sale', async () => {
    assert.equal((await update({ quantity: 8, expected_quantity: 10, reason: 'Count' })).statusCode, 409);
    assert.ok(rolledBack && released && !committed);
});
test('stock and audit log commit together after locking the inventory row', async () => {
    assert.equal((await update({ quantity: 0, expected_quantity: 7, reason: 'Stock count' })).statusCode, 200);
    assert.ok(queries[0].sql.endsWith('FOR UPDATE'));
    assert.equal(queries[1].params[0], 0);
    assert.ok(queries[2].sql.includes('activity_logs'));
    assert.ok(committed && released && !rolledBack);
});
