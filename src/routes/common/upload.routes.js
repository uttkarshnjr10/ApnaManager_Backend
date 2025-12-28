const express = require('express');
const router = express.Router();
const { uploadSingleImage } = require('../../controllers/common/upload.controller'); 
const { protect, authorize } = require('../../middleware/auth.middleware'); 
const { photoUpload } = require('../../middleware/upload.middleware'); 

router.post('/', protect, photoUpload.single('image'), uploadSingleImage);

module.exports = router;