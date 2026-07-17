const express = require('express');
const router = express.Router();
const {
  registerGuest,
  checkoutGuest,
  getTodaysGuests,
  getAllGuests,
  getGuestById,
  generateGuestReport,
  getCFormStatus,
  markCFormSubmitted,
  getPendingCForms,
} = require('../controllers/guest.controller');
const { protect, authorize } = require('../middleware/auth.middleware');
const { photoUpload } = require('../middleware/upload.middleware');

// hotel staff Routes
router.post('/register', protect, authorize('Hotel'), photoUpload.any(), registerGuest);
router.get('/today', protect, authorize('Hotel'), getTodaysGuests);
router.get('/all', protect, authorize('Hotel'), getAllGuests);
router.get('/report', protect, authorize('Hotel'), generateGuestReport);

// C-Form Routes
router.get('/cforms/pending', protect, authorize('Hotel'), getPendingCForms);
router.get('/:id/cform', protect, authorize('Hotel'), getCFormStatus);
router.put('/:id/cform/submit', protect, authorize('Hotel'), markCFormSubmitted);

router.get('/:id', protect, authorize('Hotel'), getGuestById);
router.put('/:id/checkout', protect, authorize('Hotel'), checkoutGuest);

module.exports = router;
