require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const errorHandler = require('./src/middlewares/errorMiddleware');

// Định tuyến
const authRoutes = require('./src/routes/authRoutes');
const accountRoutes = require('./src/routes/accountRoutes');
const productRoutes = require('./src/routes/productRoutes');
const orderRoutes = require('./src/routes/orderRoutes');

const app = express();

// Middleware bảo mật
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve ảnh đã upload từ thư mục public/
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Giới hạn tốc độ request (Rate Limiter)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 100, // Giới hạn mỗi IP 100 request trong 15 phút
    message: 'Quá nhiều yêu cầu từ IP này, vui lòng thử lại sau.'
});
app.use('/api/', apiLimiter);

// Thiết lập định tuyến
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);

// Route cơ bản
app.get('/', (req, res) => {
    res.json({ message: 'Chào mừng đến với API Hệ thống Thời trang Đa kênh' });
});

// Middleware xử lý lỗi
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server đang chạy tại port ${PORT}`);
});
