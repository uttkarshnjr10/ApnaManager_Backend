const asyncHandler = require('express-async-handler');
const logger = require('../../utils/logger');
const ApiError = require('../../utils/ApiError');
const ApiResponse = require('../../utils/ApiResponse');

const uploadSingleImage = asyncHandler(async (req, res) => {


    if (!req.file) {
        throw new ApiError(400, 'no image file provided or upload failed');
    }
    
    const imageUrl = req.file.path;
    logger.info(`image uploaded successfully to cloudinary: ${imageUrl}`);

    const responseData = {
        imageUrl: imageUrl,
        public_id: req.file.filename, 
    };

    res
    .status(200)
    .json(new ApiResponse(200, responseData, 'image uploaded successfully'));
});

module.exports = { uploadSingleImage };
