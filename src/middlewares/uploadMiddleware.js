const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { pipeline } = require('node:stream');
const crypto = require('node:crypto');

// Cấu hình Cloudinary bằng biến môi trường
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Cấu hình Storage sử dụng Cloudinary
const storage = {
  _handleFile(req, file, callback) {
    let finished = false;
    const done = (error, result) => { if (!finished) { finished = true; callback(error, result); } };
    const stream = cloudinary.uploader.upload_stream({ folder: 'fashionOS/products', resource_type: 'image', allowed_formats: ['jpg','png','jpeg','webp','gif'], public_id: `product-${crypto.randomUUID()}` }, (error, result) => {
      if (error) return done(Object.assign(new Error('Không tải được ảnh lên Cloudinary'), { statusCode: 502 }));
      if (!result?.secure_url) return done(Object.assign(new Error('Cloudinary không trả về ảnh hợp lệ'), { statusCode: 502 }));
      done(null, { path: result.secure_url, filename: result.public_id, size: result.bytes });
    });
    pipeline(file.stream, stream, error => { if (error) done(error); });
  },
  _removeFile(req, file, callback) {
    if (!file.filename) return callback(null);
    cloudinary.uploader.destroy(file.filename, error => callback(error));
  }
};

const upload = multer({
  fileFilter: (req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)) {
      const error = new Error('Chỉ chấp nhận ảnh JPG, PNG, WEBP hoặc GIF');
      error.statusCode = 400;
      return callback(error);
    }
    callback(null, true);
  },
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // Tối đa 5MB mỗi file
    files: 10                   // Tối đa 10 file 1 lần upload
  }
});

module.exports = upload;
