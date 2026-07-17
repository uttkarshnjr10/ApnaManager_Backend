const express = require('express');
const router = express.Router();
const { getHotelAnalytics } = require('../controllers/hotelAnalytics.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

// GET /api/hotel/analytics
router.get('/analytics', protect, authorize('Hotel'), getHotelAnalytics);

module.exports = router;
