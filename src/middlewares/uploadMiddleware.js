const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const path = require('path');

// Cấu hình Cloudinary bằng biến môi trường
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Cấu hình Storage sử dụng Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'fashionOS/products', // Thư mục trên Cloudinary
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp', 'gif'],
    public_id: (req, file) => {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      // const ext = path.extname(file.originalname).toLowerCase().replace('.', ''); 
      return `product-${uniqueSuffix}`;
    },
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // Tối đa 5MB mỗi file
    files: 10                   // Tối đa 10 file 1 lần upload
  }
});

module.exports = upload;
