const asyncHandler = require('express-async-handler');
const logger = require('../utils/logger');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { uploadToCloudinary } = require('../utils/cloudinary'); // Use the utility

const uploadSingleImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, 'No image file provided');
  }

  // Fix: Use the utility because req.file.path is undefined in memory storage
  const result = await uploadToCloudinary(req.file, 'general-uploads');

  logger.info(`Image uploaded successfully to cloudinary: ${result.url}`);

  const responseData = {
    imageUrl: result.url,
    public_id: result.public_id,
  };

  res.status(200).json(new ApiResponse(200, responseData, 'Image uploaded successfully'));
});

module.exports = { uploadSingleImage };
