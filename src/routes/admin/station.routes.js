const express = require('express');
const router = express.Router();
const { createStation, getAllStations } = require('../../controllers/admin/station.controller');
const { protect, authorize } = require('../../middleware/auth.middleware');

// Allow Regional Admin
router.route('/').post(protect, authorize('Admin', 'Regional Admin'), createStation);
router.route('/').get(protect, authorize('Admin', 'Regional Admin'), getAllStations);

module.exports = router;