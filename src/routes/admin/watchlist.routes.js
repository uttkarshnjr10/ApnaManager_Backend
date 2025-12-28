const express = require('express');
const router = express.Router();
const {
    getWatchlistItems,
    addWatchlistItem,
    deleteWatchlistItem,
} = require('../../controllers/admin/watchlist.controller');
const { protect, authorize } = require('../../middleware/auth.middleware');

// Allow Regional Admin
router.route('/').get(protect, authorize('Admin', 'Police', 'Regional Admin'), getWatchlistItems);
router.route('/').post(protect, authorize('Admin', 'Police', 'Regional Admin'), addWatchlistItem);
router.route('/:id').delete(protect, authorize('Admin', 'Regional Admin'), deleteWatchlistItem);

module.exports = router;