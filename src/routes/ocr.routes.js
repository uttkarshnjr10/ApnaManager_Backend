const express = require('express');
const router = express.Router();
const { scanIdCard } = require('../controllers/ocr.controller');
const { protect, authorize } = require('../middleware/auth.middleware');
const { photoUpload } = require('../middleware/upload.middleware');

// This route will handle a POST request with a single image file named 'idImage'
router.post(
  '/scan',
  protect,
  authorize('Hotel'),
  photoUpload.single('idImage'), // Middleware to handle one file upload
  scanIdCard
);

module.exports = router;
