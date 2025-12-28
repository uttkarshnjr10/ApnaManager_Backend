const express = require('express');
const router = express.Router();
const { submitHotelInquiry, getPendingInquiries, updateInquiryStatus } = require('../../controllers/hotel/inquiry.controller.js');
const { hotelInquiryUpload } = require('../../middleware/upload.middleware.js');
const { protect, authorize } = require('../../middleware/auth.middleware.js');

router.post('/', hotelInquiryUpload, submitHotelInquiry);

// Allow Regional Admin
router.get('/pending', protect, authorize('Admin', 'Regional Admin'), getPendingInquiries);
router.patch('/:id/status', protect, authorize('Admin', 'Regional Admin'), updateInquiryStatus);

module.exports = router;