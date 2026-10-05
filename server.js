require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { Server } = require('socket.io');
const errorHandler = require('./src/middlewares/errorMiddleware');
const { setIO, ROOMS } = require('./src/config/socket');
const ensureSchema = require('./src/config/ensureSchema');

// Định tuyến
const authRoutes = require('./src/routes/authRoutes');
const accountRoutes = require('./src/routes/accountRoutes');
const productRoutes = require('./src/routes/productRoutes');
const orderRoutes = require('./src/routes/orderRoutes');
const customerRoutes = require('./src/routes/customerRoutes');
const statsRoutes = require('./src/routes/statsRoutes');
const supportRoutes = require('./src/routes/supportRoutes');
const inventoryRoutes = require('./src/routes/inventoryRoutes');
const configRoutes = require('./src/routes/configRoutes');
const reviewRoutes = require('./src/routes/reviewRoutes');
const promotionRoutes = require('./src/routes/promotionRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');
const returnRoutes = require('./src/routes/returnRoutes');
const wishlistRoutes = require('./src/routes/wishlistRoutes');
const addressRoutes = require('./src/routes/addressRoutes');
const faqRoutes = require('./src/routes/faqRoutes');
const branchRoutes = require('./src/routes/branchRoutes');
const vietmapRoutes = require('./src/routes/vietmapRoutes');

const app = express();
const server = http.createServer(app);

// Khởi tạo Socket.IO
const io = new Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:5173',
        methods: ['GET', 'POST']
    }
});
setIO(io); // Cho phép service (OrderService, NotificationService...) phát sự kiện realtime

// Middleware để chia sẻ `io` instance với các controller
app.use((req, res, next) => {
    req.io = io;
    next();
});

// Xử lý kết nối Socket.IO
io.on('connection', (socket) => {
    // Client tham gia phòng để nhận thông báo:
    //  - payload cũ: accountId (number)  → phòng account_<id>
    //  - payload mới: { id, role }       → nhân viên/admin vào thêm staff_room, khách vào customer_<id>
    socket.on('join_room', (payload) => {
        const id = typeof payload === 'object' && payload !== null ? payload.id : payload;
        const role = typeof payload === 'object' && payload !== null ? payload.role : null;
        if (!id) return;
        if (role === 'customer') {
            socket.join(ROOMS.customer(id));
        } else {
            socket.join(ROOMS.account(id));
            if (role === 'admin' || role === 'staff') socket.join(ROOMS.STAFF);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
    });
});

// Middleware bảo mật
app.use(helmet());

// CORS — chỉ cho phép origin frontend cụ thể
const corsOptions = {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
};
app.use(cors(corsOptions));
// Stripe Webhook bắt buộc phải dùng raw body thay vì json
const stripeRoutes = require('./src/routes/stripeRoutes');
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeRoutes);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Stripe Verify Route (dùng express.json bình thường)
const stripeController = require('./src/controllers/stripeController');
app.post('/api/stripe/verify-payment', stripeController.verifyPayment);

// Serve ảnh đã upload từ thư mục public/
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Giới hạn tốc độ request chung (Rate Limiter)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    // Dev (React StrictMode gọi API 2 lần + polling) rất dễ chạm 200 → bị 429 "không gọi được API"
    max: process.env.NODE_ENV === 'production' ? 300 : 5000,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({ success: false, message: 'Quá nhiều yêu cầu từ IP này, vui lòng thử lại sau.', data: null });
    }
});
app.use('/api/', apiLimiter);

// Rate limiter chặt hơn cho auth (chống brute-force)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 20, // Chỉ cho phép 20 lần đăng nhập/đăng ký mỗi 15 phút
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({ success: false, message: 'Quá nhiều lần thử đăng nhập. Vui lòng đợi 15 phút rồi thử lại.', data: null });
    }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Thiết lập định tuyến
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/config', configRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/promotions', promotionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/returns', returnRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/faqs', faqRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/vietmap', vietmapRoutes);

// Bắt lỗi 404 cho các route không tồn tại
app.get('/', (req, res) => {
    res.json({ message: 'Chào mừng đến với API Hệ thống Thời trang Đa kênh' });
});

// Middleware xử lý lỗi
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// Đảm bảo schema đầy đủ TRƯỚC khi nhận request → tránh lỗi "Unknown column" ở request đầu tiên
ensureSchema().finally(() => {
    server.listen(PORT, () => {
        console.log(`Server đang chạy tại port ${PORT}`);
        // Quét các đơn Stripe treo (server restart làm mất polling)
        const OrderService = require('./src/services/orderService');
        OrderService.sweepPendingStripeOrders();
        setInterval(() => OrderService.sweepPendingStripeOrders(), 5 * 60 * 1000);
    });
});
