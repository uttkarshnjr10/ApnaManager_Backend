const Guest = require('../models/guest.model');
const { createAuditLog } = require('../utils/auditLogger');
const Notification = require('../models/notification.model');
const asyncHandler = require('express-async-handler');
const ApiError = require('../utils/api-error');
const ApiResponse = require('../utils/api-response');
const { getRedisClient } = require('../config/redis');
const { sendPortalOTPEmail } = require('../utils/send-email');
const jwt = require('jsonwebtoken');
const PDFDocument = require('pdfkit');
const { anonymizeSingleGuest } = require('../utils/dataRetentionJob');

const maskEmail = (email) => {
  if (!email) return null;
  const [name, domain] = email.split('@');
  if (!domain) return email;
  return `${name[0]}***@${domain[0]}***.${domain.split('.')[1] || 'com'}`;
};

/**
 * @desc Request OTP for Guest Portal
 * @route POST /api/portal/verify
 * @access Public
 */
const requestPortalOTP = asyncHandler(async (req, res) => {
  const { phone } = req.body;
  
  if (!phone || typeof phone !== 'string') {
    throw new ApiError(400, 'Valid phone number is required');
  }

  const redis = getRedisClient();
  const rateLimitKey = `portal_ratelimit_${phone}`;
  
  if (redis) {
    const isRateLimited = await redis.get(rateLimitKey);
    if (isRateLimited) {
      throw new ApiError(429, 'Too many attempts. Try again in 1 hour.');
    }
  }

  // Always return same success message shape to prevent phone enumeration
  const defaultResponse = new ApiResponse(200, null, 'If this phone number is in our records, you will receive a verification code.');

  // Find most recent guest with this phone
  const guest = await Guest.findOne({ 'primaryGuest.phone': phone })
    .sort({ registrationTimestamp: -1 })
    .lean();

  if (!guest || !guest.primaryGuest?.email) {
    return res.status(200).json(defaultResponse);
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  if (redis) {
    const otpKey = `portal_otp_${phone}`;
    await redis.setEx(otpKey, 600, JSON.stringify({ otp, attempts: 0 })); // 10 minutes
  }

  // Send OTP
  await sendPortalOTPEmail(guest.primaryGuest.email, otp);

  res.status(200).json(new ApiResponse(200, {
    maskedEmail: maskEmail(guest.primaryGuest.email)
  }, 'If this phone number is in our records, you will receive a verification code.'));
});

/**
 * @desc Verify OTP and get Portal Token
 * @route POST /api/portal/confirm
 * @access Public
 */
const verifyPortalOTP = asyncHandler(async (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) {
    throw new ApiError(400, 'Phone and OTP are required');
  }

  const redis = getRedisClient();
  if (!redis) {
    throw new ApiError(500, 'Redis is not configured');
  }

  const otpKey = `portal_otp_${phone}`;
  const rateLimitKey = `portal_ratelimit_${phone}`;

  const storedDataStr = await redis.get(otpKey);
  if (!storedDataStr) {
    throw new ApiError(401, 'OTP expired or not requested');
  }

  const storedData = JSON.parse(storedDataStr);
  storedData.attempts += 1;

  if (storedData.attempts > 3) {
    await redis.del(otpKey);
    await redis.setEx(rateLimitKey, 3600, '1'); // 1 hour lockout
    throw new ApiError(429, 'Too many failed attempts. Try again in 1 hour.');
  }

  if (storedData.otp !== otp) {
    await redis.setEx(otpKey, 600, JSON.stringify(storedData)); // Update attempts
    throw new ApiError(401, 'Incorrect code');
  }

  // OTP Matches!
  await redis.del(otpKey);
  
  const portalToken = jwt.sign(
    { phone },
    process.env.JWT_SECRET,
    { expiresIn: '30m' }
  );

  res.status(200).json(new ApiResponse(200, { portalToken }, 'Verified successfully'));
});

/**
 * @desc Get my records
 * @route GET /api/portal/records
 * @access Private (Portal Token)
 */
const getMyRecords = asyncHandler(async (req, res) => {
  const phone = req.portalPhone;

  const guests = await Guest.find({ 'primaryGuest.phone': phone })
    .populate('hotel', 'hotelName city')
    .sort({ registrationTimestamp: -1 })
    .lean();

  const formattedRecords = guests.map(g => {
    const canRequestDeletion = g.retentionExpiresAt && new Date(g.retentionExpiresAt) <= new Date() && !g.isAnonymized;
    
    return {
      id: g.customerId,
      hotelName: g.hotel?.hotelName,
      hotelCity: g.hotel?.city,
      checkIn: g.stayDetails?.checkIn,
      checkOut: g.stayDetails?.checkOut,
      status: g.status,
      isAnonymized: g.isAnonymized,
      anonymizedAt: g.anonymizedAt,
      canRequestDeletion,
      retentionExpiresAt: g.retentionExpiresAt,
      deletionScheduledFor: g.deletionScheduledFor,
      registrationDate: g.registrationTimestamp
    };
  });

  res.status(200).json(new ApiResponse(200, {
    records: formattedRecords,
    totalCount: formattedRecords.length
  }, 'Records fetched'));
});

/**
 * @desc Request deletion/anonymization
 * @route POST /api/portal/delete-request
 * @access Private (Portal Token)
 */
const requestDeletion = asyncHandler(async (req, res) => {
  const phone = req.portalPhone;
  const { recordId } = req.body;

  const guest = await Guest.findOne({ customerId: recordId });
  if (!guest) throw new ApiError(404, 'Record not found');

  if (guest.primaryGuest.phone !== phone) {
    throw new ApiError(403, 'Not authorized to delete this record');
  }

  if (guest.isAnonymized) {
    return res.status(200).json(new ApiResponse(200, null, 'Record already anonymized'));
  }

  let message = '';
  
  if (guest.retentionExpiresAt && new Date(guest.retentionExpiresAt) <= new Date()) {
    // Expires immediately
    await anonymizeSingleGuest(guest);
    message = 'Your data has been anonymized immediately.';
  } else {
    // Schedule for future
    guest.deletionRequestedAt = new Date();
    guest.deletionScheduledFor = guest.retentionExpiresAt;
    await guest.save();
    message = `Your data will be deleted on ${new Date(guest.retentionExpiresAt).toLocaleDateString()}. We are required to retain records for 3 years by law.`;
  }

  await createAuditLog({
    action: 'GUEST_DELETION_REQUESTED',
    reason: 'Guest self-service portal request',
    userModel: 'RegionalAdmin'
  });

  res.status(200).json(new ApiResponse(200, { scheduledFor: guest.deletionScheduledFor }, message));
});

/**
 * @desc Download Data PDF
 * @route GET /api/portal/download/:recordId
 * @access Private (Portal Token)
 */
const downloadMyData = asyncHandler(async (req, res) => {
  const phone = req.portalPhone;
  const { recordId } = req.params;

  const guest = await Guest.findOne({ customerId: recordId }).populate('hotel', 'hotelName city');
  if (!guest) throw new ApiError(404, 'Record not found');

  if (guest.primaryGuest.phone !== phone) {
    throw new ApiError(403, 'Not authorized');
  }

  if (guest.isAnonymized) {
    throw new ApiError(400, 'Record has been anonymized and cannot be downloaded');
  }

  const doc = new PDFDocument({ margin: 50 });
  
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="my-data-${recordId}.pdf"`);
  
  doc.pipe(res);

  doc.fontSize(20).text('Your Personal Data Record', { align: 'center' });
  doc.fontSize(12).text('Apna Register', { align: 'center' });
  doc.moveDown(2);

  doc.text(`Generated On: ${new Date().toLocaleString()}`);
  doc.text(`Record ID: ${guest.customerId}`);
  doc.moveDown();

  doc.fontSize(16).text('Personal Information', { underline: true });
  doc.fontSize(12);
  doc.text(`Name: ${guest.primaryGuest.name}`);
  doc.text(`Phone: ${guest.primaryGuest.phone}`);
  doc.text(`Email: ${guest.primaryGuest.email || 'N/A'}`);
  doc.text(`Address: ${guest.primaryGuest.address?.city || 'N/A'}, ${guest.primaryGuest.address?.state || 'N/A'}`);
  doc.moveDown();

  doc.fontSize(16).text('Stay Details', { underline: true });
  doc.fontSize(12);
  doc.text(`Hotel: ${guest.hotel?.hotelName || 'N/A'}`);
  doc.text(`Check-In: ${guest.stayDetails.checkIn ? new Date(guest.stayDetails.checkIn).toLocaleString() : 'N/A'}`);
  doc.text(`Check-Out: ${guest.stayDetails.checkOut ? new Date(guest.stayDetails.checkOut).toLocaleString() : 'N/A'}`);
  doc.moveDown(2);

  doc.fontSize(16).text('Data Rights & Retention', { underline: true });
  doc.fontSize(12);
  doc.text(`Your data will be retained until ${guest.retentionExpiresAt ? new Date(guest.retentionExpiresAt).toLocaleDateString() : 'N/A'}.`);
  doc.text('You have the right to request deletion after this date via the portal.');
  doc.text('For questions, please contact the platform administrator.');

  doc.end();
});

module.exports = {
  requestPortalOTP,
  verifyPortalOTP,
  getMyRecords,
  requestDeletion,
  downloadMyData
};
