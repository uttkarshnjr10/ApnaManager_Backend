const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const {
  searchGuests,
  getDashboardData,
  createAlert,
  getAlerts,
  resolveAlert,
  getGuestHistory,
  addRemark,
  createCaseReport,
  getCaseReports,
  getHotelList,
  advancedGuestSearch,
} = require('../controllers/police.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

// 1. Security: Search Rate Limiter
// Allow max 10 searches per minute per IP
const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  message: 'Too many search attempts. Please wait a minute.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Protect all routes
router.use(protect, authorize('Police'));

router.get('/dashboard', getDashboardData);

// Apply Limiter to Search
router.post('/search', searchLimiter, searchGuests);

router.route('/alerts').post(createAlert).get(getAlerts);
router.put('/alerts/:id/resolve', resolveAlert);
router.get('/guests/:id/history', getGuestHistory);
router.post('/guests/:id/remarks', addRemark);

router.route('/reports').get(getCaseReports).post(createCaseReport);

router.get('/hotel-list', getHotelList);
router.post('/analytics-search', advancedGuestSearch);

module.exports = router;
