const express = require('express');
const router = express.Router();
const { scanIdCard } = require('../../controllers/hotel/ocr.controller'); 
const { protect, authorize } = require('../../middleware/auth.middleware');
const { photoUpload } = require('../../middleware/upload.middleware'); 

router.post('/scan', protect, authorize('Hotel'), photoUpload.single('image'), scanIdCard);

module.exports = router;