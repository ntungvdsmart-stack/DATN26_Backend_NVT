// Call inside the same transaction that locks the product and its variants.
async function assertNoHistory(connection, variantIds) {
    if (!variantIds.length) return;
    const [stock] = await connection.query('SELECT inventory_id FROM inventory WHERE variant_id IN (?) AND quantity > 0 LIMIT 1 FOR UPDATE', [variantIds]);
    if (stock.length) throw Object.assign(new Error('Không thể xóa sản phẩm/biến thể còn tồn kho. Hãy ngừng bán để giữ số liệu; nếu cần xóa, phải kiểm kê và xử lý tồn kho trước.'), { statusCode: 409, code: 'PRODUCT_IN_USE' });
    const relations = [
        ['order_items', 'variant_id', 'đã có trong đơn hàng'],
        ['customer_reviews', 'variant_id', 'đã có đánh giá của khách hàng'],
        ['order_return_items', 'exchange_variant_id', 'đã được dùng làm hàng đổi trả']
    ];
    for (const [table, column, reason] of relations) {
        const [rows] = await connection.query(`SELECT ${column} FROM ${table} WHERE ${column} IN (?) LIMIT 1`, [variantIds]);
        if (rows.length) throw Object.assign(new Error(`Không thể xóa vì sản phẩm/biến thể ${reason}. Hãy ngừng bán sản phẩm để giữ lịch sử.`), { statusCode: 409, code: 'PRODUCT_IN_USE' });
    }
}

async function clearShoppingReferences(connection, variantIds) {
    if (!variantIds.length) return;
    await connection.query('DELETE FROM cart_items WHERE variant_id IN (?)', [variantIds]);
    await connection.query('DELETE FROM wishlists WHERE variant_id IN (?)', [variantIds]);
}

module.exports = { assertNoHistory, clearShoppingReferences };
