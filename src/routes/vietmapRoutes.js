const express = require('express');
const router = express.Router();
const vietmapController = require('../controllers/vietmapController');

// GET /api/vietmap/autocomplete?text=...
router.get('/autocomplete', vietmapController.autocomplete);

// GET /api/vietmap/place?ref_id=...
router.get('/place', vietmapController.place);

module.exports = router;
