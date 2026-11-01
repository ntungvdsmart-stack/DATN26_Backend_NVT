const test = require('node:test');
const assert = require('node:assert/strict');
const { coordinates, rankBranches } = require('../src/services/branchDistanceService');
const order = { shipping_latitude: 10, shipping_longitude: 106 };
const branches = [{ branch_id: 1, latitude: 10.01, longitude: 106 }, { branch_id: 2, latitude: 11, longitude: 106 }, { branch_id: 3, latitude: null, longitude: null }];
function key(t, value) {
    const previous = process.env.VIETMAP_API_KEY;
    process.env.VIETMAP_API_KEY = value;
    t.after(() => { if (previous === undefined) delete process.env.VIETMAP_API_KEY; else process.env.VIETMAP_API_KEY = previous; });
}
test('coordinates accept zero and reject missing or invalid location', () => {
    assert.deepEqual(coordinates(0, 0), { lat: 0, lng: 0 });
    assert.equal(coordinates(null, 10), null);
    assert.equal(coordinates(91, 106), null);
});
test('VietMap road distance determines ordering, branches are origins and customer is destination', async t => {
    key(t, 'fixture-key');
    t.mock.method(global, 'fetch', async url => {
        assert.equal(url.pathname, '/api/matrix/v4');
        assert.equal(url.searchParams.get('sources'), '1;2');
        assert.equal(url.searchParams.get('destinations'), '0');
        return { ok: true, json: async () => ({ code: 'OK', distances: [[12000], [5000]] }) };
    });
    const result = await rankBranches(order, branches);
    assert.deepEqual(result.map(row => row.branch_id), [2,1,3]);
    assert.equal(result[0].distance, 5);
    assert.equal(result[0].distance_source, 'vietmap');
    assert.equal(result[2].distance, null);
});
test('provider failure falls back to explicitly labelled aerial estimates and missing positions sort last', async t => {
    key(t, 'fixture-key');
    t.mock.method(global, 'fetch', async () => { throw new Error('Timeout'); });
    const result = await rankBranches(order, branches);
    assert.deepEqual(result.map(row => row.branch_id), [1,2,3]);
    assert.equal(result[0].distance_source, 'estimated');
    assert.equal(result[2].distance_source, 'unavailable');
});
test('missing order coordinates are resolved from its shipping address via geocode/place', async t => {
    key(t, 'fixture-key');
    t.mock.method(global, 'fetch', async url => ({ ok: true, json: async () => {
        if (url.pathname.endsWith('/search/v3')) return [{ ref_id: 'fixture-place' }];
        if (url.pathname.endsWith('/place/v3')) return { lat: 10, lng: 106 };
        return { code: 'OK', distances: [[1700]] };
    } }));
    const result = await rankBranches({ shipping_address_snapshot: 'Fixture address' }, [branches[0]]);
    assert.equal(result[0].distance, 1.7);
    assert.equal(result[0].distance_source, 'vietmap');
});
