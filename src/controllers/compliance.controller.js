const ComplianceRequest = require('../models/ComplianceRequest.model');
const Guest = require('../models/guest.model');
const AccessLog = require('../models/access-log.model');
const Notification = require('../models/notification.model');
const asyncHandler = require('express-async-handler');
const ApiError = require('../utils/api-error');
const ApiResponse = require('../utils/api-response');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');
const { uploadBufferToCloudinary } = require('../utils/uploadBuffer');
const { getIO } = require('../config/socket');
const logger = require('../utils/logger');
const { generateSignedUrl } = require('../utils/cloudinary');

/**
 * Generate a new Request Reference number (e.g. CR-2025-001)
 */
const generateRequestReference = async () => {
  const currentYear = new Date().getFullYear();
  const prefix = `CR-${currentYear}-`;
  
  const lastRequest = await ComplianceRequest.findOne(
    { requestReference: new RegExp(`^${prefix}`) },
    { requestReference: 1 }
  ).sort({ requestReference: -1 });

  let sequence = 1;
  if (lastRequest && lastRequest.requestReference) {
    const parts = lastRequest.requestReference.split('-');
    if (parts.length === 3) {
      sequence = parseInt(parts[2], 10) + 1;
    }
  }

  return `${prefix}${sequence.toString().padStart(3, '0')}`;
};

/**
 * Create a new Compliance Request
 * @route POST /api/admin/compliance
 */
const createComplianceRequest = asyncHandler(async (req, res) => {
  const {
    requestingAuthority,
    requestDate,
    legalBasis,
    caseReferenceNumber,
    dataRequested,
    authorityContactName,
    authorityContactPhone
  } = req.body;

  const requestReference = await generateRequestReference();

  const complianceRequest = await ComplianceRequest.create({
    requestReference,
    requestingAuthority,
    requestDate,
    legalBasis,
    caseReferenceNumber,
    dataRequested,
    authorityContactName,
    authorityContactPhone,
    status: 'Logged'
  });

  await AccessLog.create({
    user: req.user._id,
    userModel: 'RegionalAdmin',
    action: 'COMPLIANCE_REQUEST_LOGGED',
    reason: `Logged new compliance request: ${requestReference}`
  });

  res.status(201).json(new ApiResponse(201, complianceRequest, 'Compliance Request Logged successfully'));
});

/**
 * Get all Compliance Requests
 * @route GET /api/admin/compliance
 */
const getAllComplianceRequests = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 10 } = req.query;
  const filter = {};
  if (status && status !== 'All') {
    filter.status = status;
  }

  const requests = await ComplianceRequest.find(filter)
    .select('-exportPdfPublicId')
    .sort({ requestDate: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await ComplianceRequest.countDocuments(filter);

  res.status(200).json(new ApiResponse(200, {
    requests,
    total,
    page: parseInt(page),
    pages: Math.ceil(total / limit)
  }, 'Compliance Requests retrieved'));
});

/**
 * Get Compliance Request by ID
 * @route GET /api/admin/compliance/:id
 */
const getComplianceRequestById = asyncHandler(async (req, res) => {
  const request = await ComplianceRequest.findById(req.params.id)
    .populate({
      path: 'guestsExported',
      select: 'primaryGuest.name customerId stayDetails.checkIn stayDetails.expectedCheckout stayDetails.checkOut stayDetails.roomNumber hotel',
      populate: { path: 'hotel', select: 'hotelName city' }
    });

  if (!request) {
    throw new ApiError(404, 'Compliance request not found');
  }

  // Inject a signed URL if pdf exists
  let responseData = request.toJSON();
  if (responseData.exportPdfPublicId && responseData.status === 'Fulfilled') {
    responseData.exportPdfSignedUrl = generateSignedUrl(responseData.exportPdfPublicId);
  }

  res.status(200).json(new ApiResponse(200, responseData, 'Compliance Request details retrieved'));
});

/**
 * Search Guests globally for Compliance (Admin only)
 * @route GET /api/admin/compliance/guests/search
 */
const searchGuestsForCompliance = asyncHandler(async (req, res) => {
  const { searchTerm } = req.query;
  if (!searchTerm || searchTerm.length < 3) {
    return res.status(200).json(new ApiResponse(200, [], 'Please enter at least 3 characters to search'));
  }

  const regex = new RegExp(searchTerm, 'i');
  
  // Search by name, ID number, or phone across ALL hotels
  const guests = await Guest.find({
    $or: [
      { 'primaryGuest.name': regex },
      { 'primaryGuest.phone': regex },
      { idNumber: regex },
      { customerId: regex }
    ]
  })
    .select('primaryGuest.name primaryGuest.phone idNumber customerId stayDetails.checkIn stayDetails.roomNumber hotel registrationTimestamp')
    .populate('hotel', 'hotelName city')
    .sort({ registrationTimestamp: -1 })
    .limit(20); // cap results

  res.status(200).json(new ApiResponse(200, guests, 'Guests found'));
});

/**
 * Export Data for a Compliance Request
 * @route POST /api/admin/compliance/:id/export
 */
const exportComplianceData = asyncHandler(async (req, res) => {
  const { guestIds } = req.body;
  if (!guestIds || !Array.isArray(guestIds) || guestIds.length === 0) {
    throw new ApiError(400, 'Please provide guest IDs to export');
  }

  const request = await ComplianceRequest.findById(req.params.id);
  if (!request) {
    throw new ApiError(404, 'Compliance request not found');
  }

  const guests = await Guest.find({ _id: { $in: guestIds } }).populate('hotel', 'hotelName city');
  
  if (guests.length !== guestIds.length) {
    throw new ApiError(400, 'One or more guest records could not be found');
  }

  // --- PDF GENERATION ---
  const pdfBuffer = await new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // COVER PAGE
      doc.fontSize(18).font('Helvetica-Bold').text('OFFICIAL DATA EXPORT', { align: 'center' });
      doc.fontSize(14).font('Helvetica').text('APNA MANAGER COMPLIANCE SYSTEM', { align: 'center' });
      doc.moveDown(2);

      const generatedAt = new Date().toLocaleString();
      doc.fontSize(12);
      doc.text(`Export generated: ${generatedAt}`);
      doc.text(`Generated by: ${req.user.username}`);
      doc.text(`Request Reference: ${request.requestReference}`);
      doc.text(`Requesting Authority: ${request.requestingAuthority}`);
      doc.text(`Legal Basis: ${request.legalBasis}`);
      doc.text(`Case Reference: ${request.caseReferenceNumber || 'N/A'}`);
      doc.text(`Data Requested: ${request.dataRequested}`);
      doc.text(`Number of records: ${guests.length}`);
      
      doc.moveDown(4);
      doc.font('Helvetica-Oblique').fontSize(11);
      doc.text(
        'This export was generated in response to a formal official request and is intended solely for the stated legal purpose. Unauthorized distribution of this document is prohibited.',
        { align: 'center', width: 495 }
      );

      // GUEST PAGES
      guests.forEach((g) => {
        doc.addPage();
        doc.fontSize(16).font('Helvetica-Bold').text(`Guest Reference: ${g.customerId}`);
        doc.moveDown(1);

        doc.fontSize(12).font('Helvetica');
        const pg = g.primaryGuest || {};
        const sd = g.stayDetails || {};
        const h = g.hotel || {};
        
        const dobFormatted = pg.dob ? new Date(pg.dob).toLocaleDateString() : 'N/A';
        const address = pg.address ? `${pg.address.street || ''}, ${pg.address.city || ''}, ${pg.address.state || ''} ${pg.address.zipCode || ''}`.trim() : 'N/A';

        doc.text(`Full Name: ${pg.name || 'N/A'}`);
        doc.text(`Date of Birth: ${dobFormatted}`);
        doc.text(`Gender: ${pg.gender || 'N/A'}`);
        doc.text(`Phone: ${pg.phone || 'N/A'}`);
        doc.text(`Nationality: ${pg.nationality || 'N/A'}`);
        doc.text(`Address: ${address}`);
        doc.text(`ID Type: ${g.idType || 'N/A'}`);
        doc.text(`ID Number: ${g.idNumber || 'N/A'}`);
        doc.moveDown(1);

        doc.font('Helvetica-Bold').text('Stay Details');
        doc.font('Helvetica');
        doc.text(`Hotel: ${h.hotelName || 'N/A'}, ${h.city || 'N/A'}`);
        doc.text(`Room Number: ${sd.roomNumber || 'N/A'}`);
        doc.text(`Check-in: ${sd.checkIn ? new Date(sd.checkIn).toLocaleString() : 'N/A'}`);
        doc.text(`Expected Checkout: ${sd.expectedCheckout ? new Date(sd.expectedCheckout).toLocaleString() : 'N/A'}`);
        doc.text(`Actual Checkout: ${sd.checkOut ? new Date(sd.checkOut).toLocaleString() : 'N/A'}`);
        doc.text(`Purpose of Visit: ${sd.purposeOfVisit || 'N/A'}`);
      });

      // LAST PAGE - AUDIT
      doc.addPage();
      doc.fontSize(14).font('Helvetica-Bold').text('AUDIT CERTIFICATION', { align: 'center' });
      doc.moveDown(2);
      
      const hash = crypto.createHash('sha256').update(guests.map(g => g._id.toString()).join(',')).digest('hex');
      
      doc.fontSize(11).font('Helvetica').text(
        'This document was generated from encrypted records stored on MeitY-empanelled cloud infrastructure. The data has not been modified or altered.',
        { align: 'justify' }
      );
      doc.moveDown(1);
      doc.text(`Generation timestamp: ${new Date().toISOString()}`);
      doc.text(`Export hash: ${hash}`);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });

  // Upload to Cloudinary
  const uploadResult = await uploadBufferToCloudinary(pdfBuffer, `export_${request.requestReference}_${Date.now()}`, 'compliance-exports');

  // Update DB Request
  request.guestsExported = guestIds;
  request.exportPdfUrl = uploadResult.url;
  request.exportPdfPublicId = uploadResult.public_id;
  request.status = 'Fulfilled';
  request.fulfilledAt = new Date();
  request.fulfilledBy = req.user._id;
  await request.save();

  // Logging and Notifications per guest
  const uniqueHotelIds = new Set();
  
  for (const g of guests) {
    uniqueHotelIds.add(g.hotel._id.toString());
    await AccessLog.create({
      user: req.user._id,
      userModel: 'RegionalAdmin',
      action: 'COMPLIANCE_DATA_EXPORTED',
      reason: `${request.requestReference} - ${request.requestingAuthority} (Guest: ${g.customerId})`
    });
  }

  // Notify hotels
  for (const hotelId of uniqueHotelIds) {
    await Notification.create({
      recipientUser: hotelId,
      message: `A compliance data request was fulfilled for one of your guest records. Reference: ${request.requestReference}`
    });
    const io = getIO();
    io.to(hotelId).emit('NOTIFICATION', {
      message: `A compliance data request was fulfilled for one of your guest records. Reference: ${request.requestReference}`
    });
  }

  const signedUrl = generateSignedUrl(uploadResult.public_id);
  res.status(200).json(new ApiResponse(200, { request, signedUrl }, 'Compliance Data Exported successfully'));
});

/**
 * Reject Compliance Request
 * @route PUT /api/admin/compliance/:id/reject
 */
const rejectComplianceRequest = asyncHandler(async (req, res) => {
  const { rejectionReason } = req.body;
  if (!rejectionReason) {
    throw new ApiError(400, 'Rejection reason is required');
  }

  const request = await ComplianceRequest.findByIdAndUpdate(
    req.params.id,
    { status: 'Rejected', rejectionReason },
    { new: true }
  );

  if (!request) {
    throw new ApiError(404, 'Compliance request not found');
  }

  await AccessLog.create({
    user: req.user._id,
    userModel: 'RegionalAdmin',
    action: 'COMPLIANCE_REQUEST_REJECTED',
    reason: `Request ${request.requestReference} rejected. Reason: ${rejectionReason}`
  });

  res.status(200).json(new ApiResponse(200, request, 'Compliance Request rejected'));
});

/**
 * Get Compliance Stats
 * @route GET /api/admin/compliance/stats
 */
const getComplianceStats = asyncHandler(async (req, res) => {
  const [total, logged, fulfilled, rejected] = await Promise.all([
    ComplianceRequest.countDocuments(),
    ComplianceRequest.countDocuments({ status: 'Logged' }),
    ComplianceRequest.countDocuments({ status: 'Fulfilled' }),
    ComplianceRequest.countDocuments({ status: 'Rejected' })
  ]);

  const today = new Date();
  const firstOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const firstOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  
  const [thisMonth, lastMonth] = await Promise.all([
    ComplianceRequest.countDocuments({ createdAt: { $gte: firstOfThisMonth } }),
    ComplianceRequest.countDocuments({ createdAt: { $gte: firstOfLastMonth, $lt: firstOfThisMonth } })
  ]);

  res.status(200).json(new ApiResponse(200, {
    total, logged, fulfilled, rejected, thisMonth, lastMonth
  }, 'Compliance Stats retrieved'));
});

module.exports = {
  createComplianceRequest,
  getAllComplianceRequests,
  getComplianceRequestById,
  searchGuestsForCompliance,
  exportComplianceData,
  rejectComplianceRequest,
  getComplianceStats
};
