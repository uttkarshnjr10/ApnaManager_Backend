const express = require('express');
const router = express.Router();
const {
  submitHotelInquiry,
  getPendingInquiries,
  updateInquiryStatus,
} = require('../controllers/inquiry.controller.js');
const { hotelInquiryUpload } = require('../middleware/upload.middleware.js');
const { protect, authorize } = require('../middleware/auth.middleware.js');

router.post('/hotel-registration', hotelInquiryUpload, submitHotelInquiry);

router.get('/pending', protect, authorize('Regional Admin'), getPendingInquiries);

router.put('/:id/status', protect, authorize('Regional Admin'), updateInquiryStatus);

module.exports = router;
