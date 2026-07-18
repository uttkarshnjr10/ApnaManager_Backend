const express = require('express');
const router = express.Router();
const {
  getAdminUpcomingAnonymizations,
  getHotelUpcomingAnonymizations
} = require('../controllers/retention.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

router.get('/admin/retention/upcoming', protect, authorize('Regional Admin'), getAdminUpcomingAnonymizations);
router.get('/hotel/retention/upcoming', protect, authorize('Hotel'), getHotelUpcomingAnonymizations);

module.exports = router;
