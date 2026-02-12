// src/controllers/inquiry.controller.js
const HotelInquiry = require('../models/HotelInquiry.model');
const asyncHandler = require('express-async-handler');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { uploadToCloudinary, generateSignedUrl } = require('../utils/cloudinary'); // Import utilities

const submitHotelInquiry = asyncHandler(async (req, res) => {
  // 1. Validation
  if (!req.files || !req.files.ownerSignature || !req.files.hotelStamp) {
    throw new ApiError(400, 'Owner signature and hotel stamp files are required');
  }

  // 2. Upload Logic (Parallel Uploads for Speed)
  // We collect all file upload promises
  const uploadPromises = [];

  // Helper to push upload tasks
  const pushUpload = (fileArray) => {
    if (fileArray && fileArray[0]) {
      return uploadToCloudinary(fileArray[0], 'hotel-inquiries');
    }
  };

  const signaturePromise = pushUpload(req.files.ownerSignature);
  const stampPromise = pushUpload(req.files.hotelStamp);
  const aadhaarPromise = req.files.aadhaarCard
    ? pushUpload(req.files.aadhaarCard)
    : Promise.resolve(null);

  // Wait for all uploads
  const [signatureResult, stampResult, aadhaarResult] = await Promise.all([
    signaturePromise,
    stampPromise,
    aadhaarPromise,
  ]);

  // 3. Create Inquiry Object
  const newInquiry = new HotelInquiry({
    ...req.body,
    ownerSignature: {
      public_id: signatureResult.public_id,
      url: signatureResult.url,
    },
    hotelStamp: {
      public_id: stampResult.public_id,
      url: stampResult.url,
    },
    // Handle optional Aadhaar
    aadhaarCard: aadhaarResult
      ? {
          public_id: aadhaarResult.public_id,
          url: aadhaarResult.url,
        }
      : undefined,
  });

  await newInquiry.save();

  res
    .status(201)
    .json(new ApiResponse(201, newInquiry, 'Hotel registration request submitted successfully'));
});

const getPendingInquiries = asyncHandler(async (req, res) => {
  const inquiries = await HotelInquiry.find({ status: 'pending' }).sort({ createdAt: -1 });

  // 4. SIGN THE URLS (RBAC)
  // Since images are "authenticated" in Cloudinary, we must sign them
  // so the Admin can view them on the dashboard.
  const secureInquiries = inquiries.map((inq) => {
    const doc = inq.toObject();
    return {
      ...doc,
      ownerSignature: {
        ...doc.ownerSignature,
        url: generateSignedUrl(doc.ownerSignature?.public_id),
      },
      hotelStamp: {
        ...doc.hotelStamp,
        url: generateSignedUrl(doc.hotelStamp?.public_id),
      },
      aadhaarCard: doc.aadhaarCard
        ? {
            ...doc.aadhaarCard,
            url: generateSignedUrl(doc.aadhaarCard?.public_id),
          }
        : undefined,
    };
  });

  res.status(200).json(new ApiResponse(200, secureInquiries));
});

const updateInquiryStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;

  // Status validation
  if (!['approved', 'rejected'].includes(status)) {
    throw new ApiError(400, 'Invalid status provided');
  }

  const inquiry = await HotelInquiry.findByIdAndUpdate(req.params.id, { status }, { new: true });

  if (!inquiry) {
    throw new ApiError(404, 'Inquiry not found');
  }

  const message = `Inquiry ${status} successfully`;
  res.status(200).json(new ApiResponse(200, inquiry, message));
});

module.exports = {
  submitHotelInquiry,
  getPendingInquiries,
  updateInquiryStatus,
};
