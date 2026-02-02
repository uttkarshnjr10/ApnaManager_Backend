const express = require('express');
const router = express.Router();
const weatherController = require('../controllers/weather.controller');
const { protect } = require('../middleware/auth.middleware'); 

// GET /api/weather/current
router.get('/current', protect, weatherController.getDashboardWeather);

module.exports = router;