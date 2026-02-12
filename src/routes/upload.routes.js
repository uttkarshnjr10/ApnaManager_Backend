// routes/upload.routes.js
const express = require('express');
const router = express.Router();
const { uploadSingleImage } = require('../controllers/upload.controller');
const { protect, authorize } = require('../middleware/auth.middleware');
const { photoUpload } = require('../middleware/upload.middleware');

router.post(
  '/single-image',
  protect,
  authorize('Hotel'),
  photoUpload.single('image'),
  uploadSingleImage
);

module.exports = router;
