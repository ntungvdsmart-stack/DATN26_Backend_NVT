const PERMISSIONS = {
    'products.read': 'Xem sản phẩm', 'products.manage': 'Thêm, sửa và ngừng bán sản phẩm',
    'catalog.manage': 'Quản lý danh mục, thương hiệu và thuộc tính',
    'inventory.read': 'Xem tồn kho', 'inventory.manage': 'Điều chỉnh tồn kho chi nhánh',
    'pos.sell': 'Bán hàng tại quầy', 'orders.read': 'Xem đơn hàng', 'orders.manage': 'Xử lý đơn hàng',
    'customers.read': 'Xem khách hàng', 'customers.manage': 'Quản lý khách hàng',
    'promotions.read': 'Xem khuyến mãi', 'promotions.manage': 'Quản lý khuyến mãi',
    'returns.manage': 'Xử lý đổi trả', 'support.manage': 'Hỗ trợ khách hàng',
    'stats.read': 'Xem thống kê', 'branches.read': 'Xem danh sách chi nhánh'
};
const DEFAULT_GRANTS = {
    Staff: ['products.read', 'inventory.read', 'inventory.manage', 'pos.sell', 'orders.read', 'orders.manage', 'customers.read', 'customers.manage', 'promotions.read', 'returns.manage', 'support.manage', 'stats.read', 'branches.read']
};
const permissionForRequest = (req) => {
    const resource = req.baseUrl.split('/').pop();
    const read = ['GET', 'HEAD'].includes(req.method);
    const path = req.path;
    if (resource === 'products') return !read && path.startsWith('/attributes') ? 'catalog.manage' : read ? 'products.read' : 'products.manage';
    if (resource === 'orders') return path === '/pos' ? 'pos.sell' : read ? 'orders.read' : 'orders.manage';
    if (resource === 'inventory') return read ? 'inventory.read' : 'inventory.manage';
    if (resource === 'customers' && !path.startsWith('/me')) return read ? 'customers.read' : 'customers.manage';
    if (resource === 'promotions') return read ? 'promotions.read' : 'promotions.manage';
    if (resource === 'returns') return 'returns.manage';
    if (resource === 'support') return 'support.manage';
    if (resource === 'stats') return path === '/order-workload' ? 'orders.read' : 'stats.read';
    if (resource === 'reviews' && path === '/manage') return 'orders.read';
    if (resource === 'branches') return 'branches.read';
    return null;
};
module.exports = { PERMISSIONS, DEFAULT_GRANTS, permissionForRequest };
