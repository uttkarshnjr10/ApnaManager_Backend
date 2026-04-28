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
  verifySession,
  getSessionStatus,
} = require('../controllers/police.controller');
const { protect, authorize } = require('../middleware/auth.middleware');
const { requireVerifiedSession } = require('../middleware/police-session.middleware');
const { photoUpload } = require('../middleware/upload.middleware');

// 1. Security: Search Rate Limiter
// Allow max 10 searches per minute per IP
const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  message: 'Too many search attempts. Please wait a minute.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Protect all routes — only Police officers
router.use(protect, authorize('Police'));

// ── Session Verification (no session guard — these CREATE/CHECK the session) ──
router.post('/verify-session', photoUpload.single('verificationPhoto'), verifySession);
router.get('/session-status', getSessionStatus);

// ── Unguarded operational routes ──
router.get('/dashboard', getDashboardData);
router.get('/hotel-list', getHotelList);

// ── Guarded routes — require active verification session ──
router.post('/search', searchLimiter, requireVerifiedSession, searchGuests);
router.post('/analytics-search', requireVerifiedSession, advancedGuestSearch);
router.get('/guests/:id/history', requireVerifiedSession, getGuestHistory);
router.post('/guests/:id/remarks', requireVerifiedSession, addRemark);

router.route('/alerts')
  .post(requireVerifiedSession, createAlert)
  .get(getAlerts);
router.put('/alerts/:id/resolve', requireVerifiedSession, resolveAlert);

router.route('/reports').get(getCaseReports).post(requireVerifiedSession, createCaseReport);

module.exports = router;

