const assert = require('node:assert/strict');
module.exports = async ({ request, admin, customer, db }) => {
    const makeProduct = async name => {
        const body = { product: { product_name: name, category_id: 1, base_price: 100000 }, variants: [1,2,3].map(index => ({ sku: `${name}-${index}`, price: 100000 })), images: [] };
        const created = (await request('/products', admin.token, 'POST', body, 201)).data;
        const product = (await request(`/products/admin/${created.product_id}`, admin.token)).data;
        return { ...product, body };
    };
    await db.query('INSERT IGNORE INTO carts (customer_id) VALUES (1)');
    const [[cart]] = await db.query('SELECT cart_id FROM carts WHERE customer_id=1');
    const shopping = async id => {
        await db.query('INSERT INTO cart_items (cart_id,variant_id,quantity) VALUES (?,?,1)', [cart.cart_id, id]);
        await db.query('INSERT INTO wishlists (customer_id,variant_id) VALUES (1,?)', [id]);
        await db.query('INSERT INTO inventory (variant_id,branch_id,quantity) VALUES (?,1,2)', [id]);
    };
    const count = async (table, column, id) => Number((await db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column}=?`, [id]))[0][0].n);

    const unused = await makeProduct('FK-UNUSED');
    const unusedId = unused.variants[0].variant_id;
    await shopping(unusedId);
    await db.query('INSERT INTO product_images (product_id,variant_id,image_url) VALUES (?,?,?)', [unused.product_id, unusedId, 'https://example.invalid/fk-fixture.jpg']);
    await request(`/products/${unused.product_id}`, admin.token, 'DELETE');
    for (const table of ['cart_items','wishlists','inventory']) assert.equal(await count(table, 'variant_id', unusedId), 0);
    assert.equal(await count('product_images', 'product_id', unused.product_id), 0);
    await request(`/products/${unused.product_id}`, admin.token, 'DELETE', undefined, 404);

    const variant = await makeProduct('FK-VARIANT');
    await shopping(variant.variants[0].variant_id);
    await request(`/products/${variant.product_id}/variants/${variant.variants[0].variant_id}`, admin.token, 'DELETE');
    assert.equal(await count('wishlists', 'variant_id', variant.variants[0].variant_id), 0);
    assert.equal(await count('cart_items', 'variant_id', variant.variants[0].variant_id), 0);
    await request(`/products/${variant.product_id}/variants/${variant.variants[1].variant_id}`, admin.token, 'DELETE');
    await request(`/products/${variant.product_id}/variants/${variant.variants[2].variant_id}`, admin.token, 'DELETE', undefined, 409);
    await request(`/products/${variant.product_id}`, admin.token, 'DELETE');

    const edited = await makeProduct('FK-EDIT');
    await shopping(edited.variants[0].variant_id);
    await db.query('INSERT INTO product_images (product_id,variant_id,image_url) VALUES (?,?,?)', [edited.product_id, edited.variants[0].variant_id, 'https://example.invalid/fk-edit.jpg']);
    await request(`/products/${edited.product_id}`, admin.token, 'PUT', { ...edited.body, variants: edited.variants.slice(1), images: [{ url: 'https://example.invalid/fk-edit.jpg', variant_id: edited.variants[0].variant_id }] });
    assert.equal(await count('product_variants', 'variant_id', edited.variants[0].variant_id), 0);
    const [[image]] = await db.query('SELECT variant_id FROM product_images WHERE product_id=?', [edited.product_id]);
    assert.equal(image.variant_id, null);
    await request(`/products/${edited.product_id}`, admin.token, 'DELETE');

    const used = await makeProduct('FK-HISTORY');
    await shopping(used.variants[0].variant_id);
    const [order] = await db.query("INSERT INTO orders (order_code,channel,customer_id,subtotal_amount,total_amount) VALUES ('FK-HISTORY-ORDER','online',1,100000,100000)");
    const [line] = await db.query('INSERT INTO order_items (order_id,variant_id,quantity,unit_price) VALUES (?,?,1,100000)', [order.insertId, used.variants[0].variant_id]);
    await db.query('INSERT INTO customer_reviews (customer_id,variant_id,order_id,rating) VALUES (1,?,?,5)', [used.variants[1].variant_id, order.insertId]);
    const [returned] = await db.query("INSERT INTO order_returns (order_id,return_type) VALUES (?,'exchange')", [order.insertId]);
    await db.query('INSERT INTO order_return_items (return_id,order_item_id,quantity,exchange_variant_id) VALUES (?,?,1,?)', [returned.insertId, line.insertId, used.variants[2].variant_id]);
    const blocked = await request(`/products/${used.product_id}`, admin.token, 'DELETE', undefined, 409);
    assert.equal(blocked.data.can_deactivate, true);
    for (const item of used.variants) await request(`/products/${used.product_id}/variants/${item.variant_id}`, admin.token, 'DELETE', undefined, 409);
    assert.equal(await count('wishlists', 'variant_id', used.variants[0].variant_id), 1, 'Blocked deletion must not clear wishlist');
    assert.equal(await count('cart_items', 'variant_id', used.variants[0].variant_id), 1, 'Blocked deletion must not clear cart');
    await request(`/products/${used.product_id}`, admin.token, 'PUT', { ...used.body, product: { ...used.body.product, product_name: 'Must rollback' }, variants: used.variants.slice(1) }, 409);
    const [[retained]] = await db.query('SELECT product_name FROM products WHERE product_id=?', [used.product_id]);
    assert.equal(retained.product_name, 'FK-HISTORY');
    await request(`/products/${used.product_id}/status`, admin.token, 'PATCH', { is_active: false });
    assert.equal(await count('order_items', 'order_id', order.insertId), 1);
    await request(`/products/${used.product_id}`, customer.token, 'DELETE', undefined, 403);
    // Restore the fixture's empty shopping lists for the independent wishlist scenarios.
    await db.query('DELETE FROM wishlists WHERE variant_id=?', [used.variants[0].variant_id]);
    await db.query('DELETE FROM cart_items WHERE variant_id=?', [used.variants[0].variant_id]);
    console.log('PASS foreign keys: shopping references cleared atomically; orders/reviews/exchanges retained; variant deletion and form removal checked');
};
