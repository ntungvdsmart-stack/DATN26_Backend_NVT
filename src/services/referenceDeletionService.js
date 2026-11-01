const pool = require('../config/database');

// Identifiers come only from this allowlist, never from request input.
const rules = {
    categories: { key: 'category_id', label: 'danh mục', refs: [['categories', 'parent_id', 'danh mục con'], ['products', 'category_id', 'sản phẩm']] },
    brands: { key: 'brand_id', label: 'thương hiệu', refs: [['products', 'brand_id', 'sản phẩm']] },
    sizes: { key: 'size_id', label: 'size', refs: [['product_variants', 'size_id', 'biến thể sản phẩm']] },
    colors: { key: 'color_id', label: 'màu', refs: [['product_variants', 'color_id', 'biến thể sản phẩm']] },
    materials: { key: 'material_id', label: 'chất liệu', refs: [['product_variants', 'material_id', 'biến thể sản phẩm']] },
    promotions: { key: 'promotion_id', label: 'mã ưu đãi', refs: [['order_promotions', 'promotion_id', 'lịch sử áp dụng ưu đãi']], deactivate: true },
    faqs: { key: 'faq_id', label: 'câu hỏi thường gặp', refs: [] }
};

async function deleteReference(table, id, accountId) {
    const rule = rules[table];
    if (!rule) throw new Error('Unsupported deletion resource');
    if (!/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id))) {
        throw Object.assign(new Error('Mã dữ liệu cần xóa không hợp lệ'), { statusCode: 400 });
    }
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [[row]] = await connection.query(`SELECT ${rule.key} FROM ${table} WHERE ${rule.key} = ? FOR UPDATE`, [id]);
        if (!row) { await connection.rollback(); return 0; }
        const usedBy = [];
        for (const [child, column, label] of rule.refs) {
            const [rows] = await connection.query(`SELECT ${column} FROM ${child} WHERE ${column} = ? LIMIT 1`, [id]);
            if (rows.length) usedBy.push(label);
        }
        if (usedBy.length) throw Object.assign(new Error(`Không thể xóa ${rule.label} vì đang liên kết với ${usedBy.join(', ')}. ${rule.deactivate ? 'Hãy ngừng kích hoạt để giữ lịch sử.' : 'Hãy chuyển dữ liệu liên quan sang giá trị khác trước.'}`), {
            statusCode: 409, code: 'DATA_IN_USE', details: { code: 'DATA_IN_USE', used_by: usedBy, can_deactivate: !!rule.deactivate }
        });
        await connection.query(`DELETE FROM ${table} WHERE ${rule.key} = ?`, [id]);
        if (accountId) await connection.query('INSERT INTO activity_logs (account_id, action, target_table, target_id, description) VALUES (?, ?, ?, ?, ?)',
            [accountId, 'DELETE_REFERENCE', table, id, `Xóa ${rule.label} #${id}`]);
        await connection.commit();
        return 1;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally { connection.release(); }
}

module.exports = { deleteReference };
