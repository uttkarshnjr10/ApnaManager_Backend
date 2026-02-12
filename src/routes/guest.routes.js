const express = require('express');
const router = express.Router();
const {
  registerGuest,
  checkoutGuest,
  getTodaysGuests,
  getAllGuests,
  generateGuestReport,
} = require('../controllers/guest.controller');
const { protect, authorize } = require('../middleware/auth.middleware');
const { photoUpload } = require('../middleware/upload.middleware');

// hotel staff Routes
router.post('/register', protect, authorize('Hotel'), photoUpload.any(), registerGuest);
router.get('/today', protect, authorize('Hotel'), getTodaysGuests);
router.get('/all', protect, authorize('Hotel'), getAllGuests);
router.put('/:id/checkout', protect, authorize('Hotel'), checkoutGuest);
router.get('/report', protect, authorize('Hotel'), generateGuestReport);

module.exports = router;
