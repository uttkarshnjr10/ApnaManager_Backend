// src/controllers/police.controller.js

const Guest = require('../models/guest.model');
const AccessLog = require('../models/access-log.model');
const Hotel = require('../models/hotel.model');
const Alert = require('../models/alert.model');
const Remark = require('../models/remark.model');
const CaseReport = require('../models/case-report.model');
const PoliceSession = require('../models/police-session.model');

const asyncHandler = require('../utils/async-handler');
const logger = require('../utils/logger');
const ApiError = require('../utils/api-error');
const ApiResponse = require('../utils/api-response');
const { generateSignedUrl, uploadToCloudinary } = require('../utils/cloudinary');

// ============================================================
// PRIVATE HELPERS (DRY)
// ============================================================

/**
 * Escapes special regex characters to prevent ReDoS attacks.
 * @param {string} str - Raw user input
 * @returns {string} Sanitized string safe for use inside RegExp
 */
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Fire-and-forget audit log creation.
 * Errors are logged but never propagated — intentionally decoupled from the request lifecycle.
 * @param {Object} logData - Fields for AccessLog.create()
 */
const createAuditLog = (logData) => {
  AccessLog.create(logData).catch((err) => {
    logger.error(`Audit log failed: ${err.message}`);
  });
};

/**
 * Generates signed Cloudinary URLs for all image fields on a lean guest document.
 * @param {Object|null} guest - A lean guest document (or null)
 * @returns {Object|null} Guest with signed URLs appended
 */
const signGuestImages = (guest) => {
  if (!guest) return null;
  return {
    ...guest,
    idImageFront: guest.idImageFront?.public_id
      ? { ...guest.idImageFront, url: generateSignedUrl(guest.idImageFront.public_id) }
      : null,
    idImageBack: guest.idImageBack?.public_id
      ? { ...guest.idImageBack, url: generateSignedUrl(guest.idImageBack.public_id) }
      : null,
    livePhotoURL: guest.livePhoto?.public_id ? generateSignedUrl(guest.livePhoto.public_id) : null,
  };
};

/**
 * Parses, validates, and clamps pagination parameters.
 * @param {number|string} page  - Requested page (1-based)
 * @param {number|string} limit - Requested page size
 * @param {number} [maxLimit=100] - Upper ceiling for limit
 * @returns {{ page: number, limit: number, skip: number }}
 */
const parsePagination = (page = 1, limit = 20, maxLimit = 100) => {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(maxLimit, Math.max(1, parseInt(limit, 10) || 20));
  return { page: p, limit: l, skip: (p - 1) * l };
};

/**
 * Builds a standard pagination metadata object for API responses.
 * @param {number} totalDocs - Total matching documents
 * @param {number} page      - Current page
 * @param {number} limit     - Page size
 * @returns {Object}
 */
const buildPaginationMeta = (totalDocs, page, limit) => ({
  totalDocs,
  page,
  totalPages: Math.ceil(totalDocs / limit),
  hasNextPage: page * limit < totalDocs,
});

/** Reusable projection for Hotel populates across handlers. */
const HOTEL_PROJECTION = 'username hotelName city address state';

/**
 * Build a MongoDB filter for unified search across primary + accompanying guests.
 * Returns a filter object that uses $or to cover all relevant fields.
 *
 * @param {string} searchBy - 'name' | 'phone' | 'id'
 * @param {string} query - The search term (already regex-escaped by caller)
 * @returns {Object} MongoDB filter
 */
const buildUnifiedSearchFilter = (searchBy, escapedQuery) => {
  const regexOpts = { $regex: escapedQuery, $options: 'i' };

  switch (searchBy) {
    case 'name':
      return {
        $or: [
          { 'primaryGuest.name': regexOpts },
          { 'accompanyingGuests.adults.name': regexOpts },
          { 'accompanyingGuests.children.name': regexOpts },
        ],
      };
    case 'phone':
      // Only primary guests have phone numbers in the schema
      return { 'primaryGuest.phone': regexOpts };
    case 'id':
      return {
        $or: [
          { idNumber: regexOpts },
          { 'accompanyingGuests.adults.idNumber': regexOpts },
          { 'accompanyingGuests.children.idNumber': regexOpts },
        ],
      };
    default:
      return null;
  }
};

/**
 * Identify who in the booking matched the search query.
 * Returns { matchRole, matchedPersonName } for display in search results.
 *
 * @param {Object} guest - Lean guest document
 * @param {string} searchBy - 'name' | 'phone' | 'id'
 * @param {RegExp} queryRegex - The compiled search regex
 * @returns {{ matchRole: string, matchedPersonName: string|null }}
 */
const identifyMatchRole = (guest, searchBy, queryRegex) => {
  // Check primary guest first
  if (searchBy === 'name' && queryRegex.test(guest.primaryGuest?.name)) {
    return { matchRole: 'Primary Guest', matchedPersonName: null };
  }
  if (searchBy === 'phone' && queryRegex.test(guest.primaryGuest?.phone)) {
    return { matchRole: 'Primary Guest', matchedPersonName: null };
  }
  if (searchBy === 'id' && queryRegex.test(guest.idNumber)) {
    return { matchRole: 'Primary Guest', matchedPersonName: null };
  }

  // Check accompanying guests
  const allAccompanying = [
    ...(guest.accompanyingGuests?.adults || []),
    ...(guest.accompanyingGuests?.children || []),
  ];

  for (const acc of allAccompanying) {
    if (searchBy === 'name' && queryRegex.test(acc.name)) {
      return { matchRole: 'Accompanying Guest', matchedPersonName: acc.name };
    }
    if (searchBy === 'id' && queryRegex.test(acc.idNumber)) {
      return { matchRole: 'Accompanying Guest', matchedPersonName: acc.name };
    }
  }

  return { matchRole: 'Primary Guest', matchedPersonName: null };
};

// ============================================================
// CONTROLLERS
// ============================================================

/**
 * Search guest records by name, phone, or ID number.
 * Searches across ALL persons in a booking (primary + accompanying).
 * Creates a non-blocking audit log for every search attempt.
 *
 * @desc    Unified guest search
 * @route   POST /api/police/search
 * @access  Private/Police
 */
const searchGuests = asyncHandler(async (req, res) => {
  const { query, searchBy, reason } = req.body;

  if (!query || !searchBy || !reason) {
    throw new ApiError(400, 'Search query, type (searchBy), and reason are required');
  }

  const validSearchTypes = ['name', 'phone', 'id'];
  if (!validSearchTypes.includes(searchBy)) {
    throw new ApiError(400, "Invalid searchBy value. Use 'name', 'phone', or 'id'");
  }

  const { page, limit, skip } = parsePagination(req.body.page, req.body.limit);
  const escaped = escapeRegex(query);
  const filter = buildUnifiedSearchFilter(searchBy, escaped);

  // Fire-and-forget audit log — never blocks the response
  createAuditLog({
    user: req.user._id,
    userModel: 'Police',
    action: 'Guest Search',
    searchQuery: `${searchBy}: ${query}`,
    reason,
  });

  // Parallel: count + paginated fetch
  const [totalDocs, guests] = await Promise.all([
    Guest.countDocuments(filter),
    Guest.find(filter)
      .sort({ registrationTimestamp: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: 'hotel', select: HOTEL_PROJECTION })
      .lean(),
  ]);

  // Post-process: add match role and signed URLs
  const queryRegex = new RegExp(escaped, 'i');
  const enrichedGuests = guests.map((g) => {
    const { matchRole, matchedPersonName } = identifyMatchRole(g, searchBy, queryRegex);
    return {
      ...g,
      livePhotoURL: g.livePhoto?.public_id ? generateSignedUrl(g.livePhoto.public_id) : null,
      matchRole,
      matchedPersonName,
    };
  });

  res.status(200).json(
    new ApiResponse(200, {
      guests: enrichedGuests,
      pagination: buildPaginationMeta(totalDocs, page, limit),
    })
  );
});

/**
 * Aggregate police dashboard statistics: total hotels, today's check-ins, open alerts.
 * All three independent queries run in parallel via Promise.all.
 *
 * @desc    Get police dashboard data
 * @route   GET /api/police/dashboard
 * @access  Private/Police
 */
const getDashboardData = asyncHandler(async (req, res) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [totalHotels, guestsToday, alerts] = await Promise.all([
    Hotel.countDocuments(),
    Guest.countDocuments({ registrationTimestamp: { $gte: startOfToday } }),
    Alert.find({ status: 'Open' })
      .populate('guest', 'primaryGuest.name')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
  ]);

  res.status(200).json(new ApiResponse(200, { totalHotels, guestsToday, alerts }));
});

/**
 * Create a new alert flagging a specific guest.
 * Validates guest existence (lightweight) and logs the action asynchronously.
 *
 * @desc    Create a guest alert
 * @route   POST /api/police/alerts
 * @access  Private/Police
 */
const createAlert = asyncHandler(async (req, res) => {
  const { guestId, reason } = req.body;

  if (!guestId || !reason) {
    throw new ApiError(400, 'Guest ID and reason are required');
  }

  // Lightweight existence check — only fetch the field needed for the audit log
  const guest = await Guest.findById(guestId).select('primaryGuest.name').lean();
  if (!guest) {
    throw new ApiError(404, 'Guest not found');
  }

  const alert = await Alert.create({
    guest: guestId,
    reason,
    createdBy: req.user._id,
    creatorModel: 'Police',
  });

  // Fire-and-forget audit
  createAuditLog({
    user: req.user._id,
    userModel: 'Police',
    action: 'Alert Created',
    reason: `Flagged guest ${guest.primaryGuest.name} for: ${reason}`,
  });

  res.status(201).json(new ApiResponse(201, alert, 'Alert created successfully'));
});

/**
 * Retrieve all alerts with pagination, newest first.
 * Uses .lean() to avoid Mongoose document overhead.
 *
 * @desc    Get all alerts (paginated)
 * @route   GET /api/police/alerts
 * @access  Private/Police
 */
const getAlerts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query.page, req.query.limit);

  const [totalDocs, alerts] = await Promise.all([
    Alert.countDocuments(),
    Alert.find()
      .populate('guest', 'primaryGuest.name idNumber')
      .populate('createdBy', 'username station')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  res.status(200).json(
    new ApiResponse(200, {
      alerts,
      pagination: buildPaginationMeta(totalDocs, page, limit),
    })
  );
});

/**
 * Mark an alert as resolved (atomic update — single DB call).
 *
 * @desc    Resolve an alert
 * @route   PUT /api/police/alerts/:id/resolve
 * @access  Private/Police
 */
const resolveAlert = asyncHandler(async (req, res) => {
  const alert = await Alert.findByIdAndUpdate(
    req.params.id,
    { status: 'Resolved' },
    { new: true, runValidators: true }
  ).lean();

  if (!alert) {
    throw new ApiError(404, 'Alert not found');
  }

  res.status(200).json(new ApiResponse(200, alert, 'Alert resolved'));
});

/**
 * Build a comprehensive cross-hotel history for a guest:
 * all stay records, alerts, and officer remarks matched by ID document number.
 * Parallel DB queries via Promise.all; fire-and-forget audit log.
 *
 * @desc    Get guest history (cross-hotel)
 * @route   GET /api/police/guests/:id/history
 * @access  Private/Police
 */
const getGuestHistory = asyncHandler(async (req, res) => {
  const guest = await Guest.findById(req.params.id).lean();
  if (!guest) {
    throw new ApiError(404, 'Guest not found');
  }

  // Find all visit records across hotels by matching the ID document number
  const stayHistory = await Guest.find({ idNumber: guest.idNumber })
    .populate({ path: 'hotel', select: HOTEL_PROJECTION })
    .sort({ 'stayDetails.checkIn': -1 })
    .lean();

  const guestIds = stayHistory.map((g) => g._id);

  // Parallel fetch: alerts + remarks
  const [alerts, remarks] = await Promise.all([
    Alert.find({ guest: { $in: guestIds } })
      .populate('createdBy', 'username rank station')
      .sort({ createdAt: -1 })
      .lean(),
    Remark.find({ guest: { $in: guestIds } })
      .populate('officer', 'username rank')
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  // Fire-and-forget audit
  createAuditLog({
    user: req.user._id,
    userModel: 'Police',
    action: 'View History',
    reason: `Viewed history of ${guest.primaryGuest.name} (${guest.idNumber})`,
  });

  res.status(200).json(
    new ApiResponse(200, {
      primaryGuest: signGuestImages(guest),
      stayHistory: stayHistory.map(signGuestImages),
      alerts,
      remarks,
    })
  );
});

/**
 * Add an officer remark/note against a guest record.
 * Validates guest existence before persisting.
 *
 * @desc    Add remark to a guest
 * @route   POST /api/police/guests/:id/remarks
 * @access  Private/Police
 */
const addRemark = asyncHandler(async (req, res) => {
  const { text } = req.body;

  if (!text) {
    throw new ApiError(400, 'Remark text is required');
  }

  // Validate guest exists (cheapest possible check)
  const guestExists = await Guest.exists({ _id: req.params.id });
  if (!guestExists) {
    throw new ApiError(404, 'Guest not found');
  }

  const remark = await Remark.create({
    guest: req.params.id,
    officer: req.user._id,
    officerModel: 'Police',
    text,
  });

  // Return populated response as lean object
  const populatedRemark = await Remark.findById(remark._id).populate('officer', 'username').lean();

  res.status(201).json(new ApiResponse(201, populatedRemark, 'Remark added successfully'));
});

/**
 * File a new case report, optionally linked to a guest.
 * If a guestId is provided, validates its existence first.
 *
 * @desc    Create a case report
 * @route   POST /api/police/reports
 * @access  Private/Police
 */
const createCaseReport = asyncHandler(async (req, res) => {
  const { title, summary, guestId } = req.body;

  if (!title || !summary) {
    throw new ApiError(400, 'Title and summary are required');
  }

  // Validate referenced guest if provided
  if (guestId) {
    const guestExists = await Guest.exists({ _id: guestId });
    if (!guestExists) {
      throw new ApiError(404, 'Referenced guest not found');
    }
  }

  const report = await CaseReport.create({
    title,
    summary,
    officer: req.user._id,
    officerModel: 'Police',
    guest: guestId || null,
  });

  res.status(201).json(new ApiResponse(201, report, 'Case report filed successfully'));
});

/**
 * Retrieve case reports filed by the authenticated officer (paginated).
 * Officer populate is intentionally omitted — the caller already knows their own identity.
 *
 * @desc    Get officer's case reports
 * @route   GET /api/police/reports
 * @access  Private/Police
 */
const getCaseReports = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query.page, req.query.limit);
  const filter = { officer: req.user._id };

  const [totalDocs, reports] = await Promise.all([
    CaseReport.countDocuments(filter),
    CaseReport.find(filter)
      .populate('guest', 'primaryGuest.name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  res.status(200).json(
    new ApiResponse(200, {
      reports,
      pagination: buildPaginationMeta(totalDocs, page, limit),
    })
  );
});

/**
 * List all active hotels (name + location fields).
 *
 * @desc    Get list of active hotels
 * @route   GET /api/police/hotel-list
 * @access  Private/Police
 */
const getHotelList = asyncHandler(async (req, res) => {
  const hotels = await Hotel.find({ status: 'Active' })
    .select('hotelName city address state')
    .sort('hotelName')
    .lean();

  res.status(200).json(new ApiResponse(200, hotels));
});

/**
 * Advanced analytics search with composite filters: hotel, city, state, purpose, date range.
 * All user-supplied strings are regex-escaped to prevent ReDoS.
 * Uses .distinct() for efficient hotel ID collection when filtering by location.
 *
 * @desc    Advanced guest search with filters
 * @route   POST /api/police/analytics-search
 * @access  Private/Police
 */
const advancedGuestSearch = asyncHandler(async (req, res) => {
  const { hotel, city, state, purposeOfVisit, dateFrom, dateTo } = req.body;
  const { page, limit, skip } = parsePagination(req.body.page, req.body.limit);

  const filter = {};

  // Date range filter
  if (dateFrom || dateTo) {
    filter.registrationTimestamp = {};
    if (dateFrom) filter.registrationTimestamp.$gte = new Date(dateFrom);
    if (dateTo) filter.registrationTimestamp.$lte = new Date(dateTo);
  }

  // Purpose of visit (regex-escaped for safety)
  if (purposeOfVisit) {
    filter['stayDetails.purposeOfVisit'] = {
      $regex: escapeRegex(purposeOfVisit),
      $options: 'i',
    };
  }

  // Hotel / location filter
  if (hotel) {
    filter.hotel = hotel;
  } else if (city || state) {
    const hotelFilter = {};
    if (city) hotelFilter.city = { $regex: escapeRegex(city), $options: 'i' };
    if (state) hotelFilter.state = { $regex: escapeRegex(state), $options: 'i' };

    // .distinct() returns a plain array of ObjectIds — more efficient than .find().select()
    const matchingHotelIds = await Hotel.find(hotelFilter).distinct('_id');
    filter.hotel = { $in: matchingHotelIds };
  }

  const [totalDocs, guests] = await Promise.all([
    Guest.countDocuments(filter),
    Guest.find(filter)
      .populate('hotel', HOTEL_PROJECTION)
      .sort({ registrationTimestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  res.status(200).json(
    new ApiResponse(200, {
      guests,
      pagination: buildPaginationMeta(totalDocs, page, limit),
    })
  );
});

// ============================================================
// SESSION VERIFICATION
// ============================================================

/** Default session duration: 10 minutes */
const SESSION_DURATION_MS = 10 * 60 * 1000;

/**
 * Create a verification session by uploading a live photo.
 * The officer must capture a photo via the device camera — no gallery uploads.
 * The photo is stored in Cloudinary for audit, and a 30-minute session is created.
 *
 * @desc    Create police verification session
 * @route   POST /api/police/verify-session
 * @access  Private/Police
 */
const verifySession = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, 'Verification photo is required. Please capture a live photo.');
  }

  // Upload to Cloudinary in a dedicated folder for audit separation
  const uploadResult = await uploadToCloudinary(req.file, 'police-verification');

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);

  const session = await PoliceSession.create({
    officer: req.user._id,
    photo: {
      url: uploadResult.url,
      public_id: uploadResult.public_id,
    },
    verifiedAt: now,
    expiresAt,
    ipAddress: req.ip || req.connection?.remoteAddress || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown',
  });

  logger.info(
    `Police session created for officer ${req.user.username} (ID: ${req.user._id}), expires at ${expiresAt.toISOString()}`
  );

  res.status(201).json(
    new ApiResponse(201, {
      sessionId: session._id,
      verified: true,
      verifiedAt: session.verifiedAt,
      expiresAt: session.expiresAt,
    }, 'Verification successful. Session active.')
  );
});

/**
 * Check whether the current officer has an active verification session.
 * Used by the frontend to decide whether to show the webcam gate.
 *
 * @desc    Get police session status
 * @route   GET /api/police/session-status
 * @access  Private/Police
 */
const getSessionStatus = asyncHandler(async (req, res) => {
  const session = await PoliceSession.findOne({
    officer: req.user._id,
    expiresAt: { $gt: new Date() },
  })
    .sort({ expiresAt: -1 })
    .select('verifiedAt expiresAt')
    .lean();

  res.status(200).json(
    new ApiResponse(200, {
      verified: !!session,
      verifiedAt: session?.verifiedAt || null,
      expiresAt: session?.expiresAt || null,
    })
  );
});

module.exports = {
  searchGuests,
  getDashboardData,
  createAlert,
  getAlerts,
  resolveAlert,
  getGuestHistory,
  addRemark,
  createCaseReport,
  getCaseReports,
  getHotelList,
  advancedGuestSearch,
  verifySession,
  getSessionStatus,
};
