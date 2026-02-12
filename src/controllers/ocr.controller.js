const { ImageAnnotatorClient } = require('@google-cloud/vision');
const asyncHandler = require('express-async-handler');
const logger = require('../utils/logger');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');

// Initialize Google Vision Client
// Ensure 'GOOGLE_APPLICATION_CREDENTIALS' env var is set, or keyFilename is passed
const visionClient = new ImageAnnotatorClient();

const scanIdCard = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, 'No image file provided for scanning.');
  }

  try {
    let requestData;

    // 1. FIX: Handle Memory Storage (Buffer)
    if (req.file.buffer) {
      requestData = {
        image: { content: req.file.buffer },
      };
    }
    // 2. Handle Disk Storage (File Path)
    else if (req.file.path) {
      requestData = req.file.path;
    } else {
      throw new ApiError(400, 'File upload failed (No buffer or path found).');
    }

    const [result] = await visionClient.textDetection(requestData);
    const detections = result.textAnnotations;

    if (detections && detections.length > 0) {
      const fullText = detections[0].description;
      res.status(200).json(new ApiResponse(200, { text: fullText }, 'Text extracted successfully'));
    } else {
      throw new ApiError(404, 'No text found on the image.');
    }
  } catch (error) {
    logger.error('Google Vision API Error:', error);
    throw new ApiError(500, 'Failed to process the image with the AI service.');
  }
});

module.exports = { scanIdCard };
