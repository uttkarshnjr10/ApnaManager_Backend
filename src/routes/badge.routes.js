const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth.middleware');

const {
  getBadgeStatus,
  generateBadgeSVG,
  verifyHotelBadge
} = require('../controllers/badge.controller');

// Protected Hotel Routes
router.get('/status', protect, authorize('Hotel'), getBadgeStatus);
router.get('/download', protect, authorize('Hotel'), generateBadgeSVG);

module.exports = router;
