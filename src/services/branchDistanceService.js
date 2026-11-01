const cache = new Map();
function coordinates(lat, lng) {
    if (lat === null || lng === null || lat === undefined || lng === undefined || lat === '' || lng === '') return null;
    if (![lat,lng].every(value => ['number','string'].includes(typeof value) && String(value).trim() !== '')) return null;
    lat = Number(lat); lng = Number(lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
async function vietmap(path, params) {
    const url = new URL(`https://maps.vietmap.vn/api/${path}`);
    url.searchParams.set('apikey', process.env.VIETMAP_API_KEY);
    for (const [key, value] of params) url.searchParams.append(key, value);
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error('Map provider unavailable');
    return response.json();
}
async function geocode(address) {
    if (!process.env.VIETMAP_API_KEY || !address) return null;
    const key = String(address).trim().slice(0, 500);
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.point;
    const results = await vietmap('search/v3', [['text', key]]);
    if (!Array.isArray(results) || !results[0]?.ref_id) return null;
    const place = await vietmap('place/v3', [['refid', results[0].ref_id]]);
    const point = coordinates(place.lat, place.lng);
    if (point) {
        if (cache.size >= 200) cache.delete(cache.keys().next().value);
        cache.set(key, { point, expires: Date.now() + 600000 });
    }
    return point;
}
function aerialDistance(a, b) {
    const rad = n => n * Math.PI / 180;
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
async function rankBranches(order, branches) {
    let origin = coordinates(order.shipping_latitude, order.shipping_longitude);
    const originSource = origin ? 'stored' : 'geocoded';
    if (!origin) {
        const snapshot = String(order.shipping_address_snapshot || '');
        // Send only the delivery address to geocoding, not the recipient name/phone.
        const address = snapshot.match(/(?:ĐC|Địa chỉ):\s*([\s\S]+)$/i)?.[1] || snapshot;
        origin = await geocode(address).catch(() => null);
    }
    const resolved = [];
    // Bound concurrent address lookup requests and keep branch identity with each result.
    for (let i = 0; i < branches.length; i += 3) {
        resolved.push(...await Promise.all(branches.slice(i, i + 3).map(async branch => ({
            branch,
            point: coordinates(branch.latitude, branch.longitude) || await geocode(branch.address).catch(() => null)
        }))));
    }
    const distances = new Map();
    let source = 'unavailable';
    if (origin) {
        const located = resolved.filter(item => item.point);
        if (located.length && process.env.VIETMAP_API_KEY) {
            try {
                // Branch → customer: direction matters on one-way roads.
                for (let i = 0; i < located.length; i += 8) {
                    const chunk = located.slice(i, i + 8);
                    const params = [['point', `${origin.lat},${origin.lng}`], ...chunk.map(item => ['point', `${item.point.lat},${item.point.lng}`]), ['sources', chunk.map((_, index) => index + 1).join(';')], ['destinations', '0'], ['annotation', 'distance'], ['vehicle', 'motorcycle']];
                    const result = await vietmap('matrix/v4', params);
                    if (result.code !== 'OK' || !Array.isArray(result.distances) || result.distances.length !== chunk.length) throw new Error('Invalid distance matrix');
                    chunk.forEach((item, index) => {
                        const value = result.distances[index]?.[0];
                        if (['number','string'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0) distances.set(item.branch.branch_id, Number(value) / 1000);
                    });
                }
                source = 'vietmap';
            } catch {
                distances.clear();
                source = 'estimated';
            }
        } else if (located.length) source = 'estimated';
        if (source === 'estimated') located.forEach(item => distances.set(item.branch.branch_id, aerialDistance(item.point, origin)));
    }
    return resolved.map(({ branch, point }) => ({
        ...branch, distance: distances.get(branch.branch_id) ?? null,
        branch_location_source: coordinates(branch.latitude, branch.longitude) ? 'stored' : point ? 'geocoded' : 'unavailable',
        customer_location_source: origin ? originSource : 'unavailable',
        distance_source: distances.has(branch.branch_id) ? source : 'unavailable',
        distance_note: distances.has(branch.branch_id) ? source === 'vietmap' ? 'Quãng đường VietMap' : 'Ước tính đường chim bay; VietMap chưa sẵn sàng' : 'Chưa xác định vị trí hoặc không có tuyến đường'
    })).sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || Number(a.branch_id) - Number(b.branch_id));
}
module.exports = { coordinates, aerialDistance, rankBranches };
