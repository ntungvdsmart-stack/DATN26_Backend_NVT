const express = require('express');
const router = express.Router();
const promotionController = require('../controllers/promotionController');
const { protect, authorize } = require('../middlewares/authMiddleware');

// Public route to apply promotion (can also pass optional token for customer limits)
// Using an optional auth middleware if needed, but for now we'll decode it inside if present
router.post('/apply', (req, res, next) => {
  // Extract token manually to check if it's a logged-in user, but don't fail if not
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const jwt = require('jsonwebtoken');
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
    } catch (err) {
      // ignore invalid token for guest checkout
    }
  }
  next();
}, promotionController.apply);

// Admin routes
router.use(protect);
router.use(authorize('admin', 'staff'));

router.get('/', promotionController.getAll);
router.post('/', promotionController.create);
router.put('/:id', promotionController.update);
router.delete('/:id', promotionController.delete);

module.exports = router;
