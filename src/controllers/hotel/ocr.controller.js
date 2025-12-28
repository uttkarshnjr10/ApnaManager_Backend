const { ImageAnnotatorClient } = require('@google-cloud/vision');
const asyncHandler = require('express-async-handler');
// FIXED IMPORTS below (added extra ../)
const logger = require('../../utils/logger');
const ApiError = require('../../utils/ApiError');
const ApiResponse = require('../../utils/ApiResponse');

// Creates a client
const visionClient = new ImageAnnotatorClient();

/**
 * @desc    Scan an ID card image and extract text
 * @route   POST /api/ocr/scan
 * @access  Private/Hotel
 */
const scanIdCard = asyncHandler(async (req, res) => {
    if (!req.file) {
        throw new ApiError(400, 'No image file provided for scanning.');
    }

    try {
        const [result] = await visionClient.textDetection(req.file.path);
        const detections = result.textAnnotations;

        if (detections && detections.length > 0) {
            const fullText = detections[0].description;
            res
            .status(200)
            .json(new ApiResponse(200, { text: fullText }, 'Text extracted successfully'));
        } else {
            throw new ApiError(404, 'No text found on the image.');
        }

    } catch (error) {
        logger.error('Google Vision API Error:', error);
        throw new ApiError(500, 'Failed to process the image with the AI service.');
    }
});

module.exports = { scanIdCard };