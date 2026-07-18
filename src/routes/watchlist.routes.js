const express = require('express');
const router = express.Router();
const {
  getWatchlistItems,
  addWatchlistItem,
  deleteWatchlistItem,
  getWatchlistAlerts,
  dismissAlert,
  actionAlert,
} = require('../controllers/watchlist.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

// Only the 'Regional Admin' can manage the watchlist
router.use(protect, authorize('Regional Admin'));

router.route('/alerts').get(getWatchlistAlerts);
router.route('/alerts/:id/dismiss').put(dismissAlert);
router.route('/alerts/:id/action').put(actionAlert);

router.route('/').get(getWatchlistItems).post(addWatchlistItem);

router.route('/:id').delete(deleteWatchlistItem);

module.exports = router;
