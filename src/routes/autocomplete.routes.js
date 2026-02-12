const express = require('express');
const router = express.Router();
const { getAutocompleteSuggestions } = require('../controllers/autocomplete.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

// This route will handle GET requests to /api/autocomplete?field=city&query=...
router.get('/', protect, authorize('Hotel'), getAutocompleteSuggestions);

module.exports = router;
