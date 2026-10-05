const express = require('express');
const router = express.Router();
const stripeController = require('../controllers/stripeController');

// Route này KHÔNG nhận app.use(express.json()) vì nó đã được hứng ở server.js với express.raw()
router.post('/', stripeController.handleWebhook);

module.exports = router;
