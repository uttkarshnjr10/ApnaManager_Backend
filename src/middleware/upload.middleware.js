const multer = require('multer');
const ApiError = require('../utils/ApiError');

const storage = multer.memoryStorage();

// Strict File Filter (images only)
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new ApiError(400, 'Only image files are allowed!'), false);
  }
};

const photoUpload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit (backup for frontend compression)
  fileFilter: fileFilter,
});

const hotelInquiryUpload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: fileFilter,
}).fields([
  { name: 'ownerSignature', maxCount: 1 },
  { name: 'hotelStamp', maxCount: 1 },
  { name: 'aadhaarCard', maxCount: 1 },
]);

module.exports = { photoUpload, hotelInquiryUpload };
