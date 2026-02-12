// src/routes/policeStation.routes.js
const express = require('express');
const router = express.Router();
const { createStation, getAllStations } = require('../controllers/policeStation.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

router.use(protect, authorize('Regional Admin'));

router.route('/').get(getAllStations).post(createStation);

module.exports = router;
