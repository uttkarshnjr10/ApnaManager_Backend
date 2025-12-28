const express = require('express');
const router = express.Router();
const { getAutocompleteSuggestions } = require('../../controllers/hotel/autocomplete.controller'); 
const { protect, authorize } = require('../../middleware/auth.middleware'); 

router.get('/', protect, authorize('Hotel', 'Admin'), getAutocompleteSuggestions);

module.exports = router;