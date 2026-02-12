// src/controllers/police.controller.js
const Guest = require('../models/Guest.model');
const AccessLog = require('../models/AccessLog.model');
const Hotel = require('../models/Hotel.model');
const Alert = require('../models/Alert.model');
const Remark = require('../models/Remark.model');
const CaseReport = require('../models/CaseReport.model');

const Police = require('../models/Police.model');
const RegionalAdmin = require('../models/RegionalAdmin.model');

const asyncHandler = require('express-async-handler');
const logger = require('../utils/logger');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { generateSignedUrl } = require('../utils/cloudinary');

// --- 1. SEARCH GUESTS ---
const searchGuests = asyncHandler(async (req, res) => {
  const { query, searchBy, reason, page = 1, limit = 20 } = req.body;

  if (!query || !searchBy || !reason) {
    throw new ApiError(400, 'Search query, type (searchBy), and reason are required');
  }

  // Non-Blocking Audit Log
  setImmediate(async () => {
    try {
      await AccessLog.create({
        user: req.user._id,
        userModel: 'Police',
        action: 'Guest Search',
        searchQuery: `${searchBy}: ${query}`,
        reason: reason,
      });
    } catch (err) {
      logger.error(`Failed to log search access: ${err.message}`);
    }
  });

  let searchCriteria = {};
  const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  switch (searchBy) {
    case 'name':
      searchCriteria['primaryGuest.name'] = { $regex: new RegExp(safeQuery, 'i') };
      break;
    case 'phone':
      searchCriteria['primaryGuest.phone'] = { $regex: new RegExp(safeQuery, 'i') };
      break;
    case 'id':
      searchCriteria['idNumber'] = { $regex: new RegExp(safeQuery, 'i') };
      break;
    default:
      throw new ApiError(400, "Invalid searchBy value. Use 'name', 'phone', or 'id'");
  }

  const totalDocs = await Guest.countDocuments(searchCriteria);
  const guests = await Guest.find(searchCriteria)
    .sort({ registrationTimestamp: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .populate({ path: 'hotel', select: 'username hotelName city', model: 'Hotel' })
    .lean();

  const guestsWithSignedUrls = guests.map((guest) => ({
    ...guest,
    livePhotoURL: guest.livePhoto?.public_id ? generateSignedUrl(guest.livePhoto.public_id) : null,
  }));

  res.status(200).json(
    new ApiResponse(200, {
      guests: guestsWithSignedUrls,
      pagination: {
        totalDocs,
        page: parseInt(page),
        totalPages: Math.ceil(totalDocs / limit),
        hasNextPage: page * limit < totalDocs,
      },
    })
  );
});

// --- 2. DASHBOARD DATA ---
const getDashboardData = asyncHandler(async (req, res) => {
  const hotelCount = await Hotel.countDocuments();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const guestsTodayCount = await Guest.countDocuments({
    registrationTimestamp: { $gte: startOfToday },
  });

  const recentAlerts = await Alert.find({ status: 'Open' })
    .populate('guest', 'primaryGuest.name')
    .sort({ createdAt: -1 })
    .limit(5);

  const dashboardData = {
    totalHotels: hotelCount,
    guestsToday: guestsTodayCount,
    alerts: recentAlerts,
  };

  res.status(200).json(new ApiResponse(200, dashboardData));
});

// --- 3. ALERTS ---
const createAlert = asyncHandler(async (req, res) => {
  const { guestId, reason } = req.body;
  if (!guestId || !reason) {
    throw new ApiError(400, 'guest id and reason are required');
  }

  const guestExists = await Guest.findById(guestId);
  if (!guestExists) {
    throw new ApiError(404, 'guest not found');
  }

  const alert = await Alert.create({
    guest: guestId,
    reason,
    createdBy: req.user._id,
    creatorModel: 'Police',
  });

  await AccessLog.create({
    user: req.user._id,
    userModel: 'Police',
    action: 'Alert Created',
    reason: `flagged guest ${guestExists.primaryGuest.name} for: ${reason}`,
  });

  res.status(201).json(new ApiResponse(201, alert, 'alert created successfully'));
});

const getAlerts = asyncHandler(async (req, res) => {
  const alerts = await Alert.find()
    .populate('guest', 'primaryGuest.name idNumber')
    .populate('createdBy', 'username station')
    .sort({ createdAt: -1 });

  res.status(200).json(new ApiResponse(200, alerts));
});

const resolveAlert = asyncHandler(async (req, res) => {
  const alert = await Alert.findById(req.params.id);
  if (!alert) {
    throw new ApiError(404, 'alert not found');
  }

  alert.status = 'Resolved';
  const updatedAlert = await alert.save();

  res.status(200).json(new ApiResponse(200, updatedAlert, 'alert resolved'));
});

// --- 4. GUEST HISTORY (ROBUST) ---
const getGuestHistory = asyncHandler(async (req, res) => {
  const guestId = req.params.id;
  const guest = await Guest.findById(guestId);
  if (!guest) {
    throw new ApiError(404, 'Guest not found');
  }

  // 1. Find all visits by this person (matching ID Number)
  const stayHistory = await Guest.find({ idNumber: guest.idNumber })
    .populate({ path: 'hotel', select: 'username hotelName city', model: 'Hotel' })
    .sort({ 'stayDetails.checkIn': -1 })
    .lean();

  const guestIds = stayHistory.map((g) => g._id);

  // 2. Fetch Alerts (Safely populated using refPath)
  const alerts = await Alert.find({ guest: { $in: guestIds } })
    .populate('createdBy', 'username rank station')
    .sort({ createdAt: -1 })
    .lean();

  // 3. Fetch Remarks
  const remarks = await Remark.find({ guest: { $in: guestIds } })
    .populate('officer', 'username rank')
    .sort({ createdAt: -1 })
    .lean();

  // 4. Helper for signing URLs
  const signImages = (g) => {
    if (!g) return null;
    return {
      ...g,
      idImageFront: g.idImageFront?.public_id
        ? { ...g.idImageFront, url: generateSignedUrl(g.idImageFront.public_id) }
        : null,
      idImageBack: g.idImageBack?.public_id
        ? { ...g.idImageBack, url: generateSignedUrl(g.idImageBack.public_id) }
        : null,
      livePhotoURL: g.livePhoto?.public_id ? generateSignedUrl(g.livePhoto.public_id) : null,
    };
  };

  setImmediate(async () => {
    try {
      await AccessLog.create({
        user: req.user._id,
        userModel: 'Police',
        action: 'View History',
        reason: `Viewed history of ${guest.primaryGuest.name} (${guest.idNumber})`,
      });
    } catch (e) {
      console.error('Audit Log Fail', e);
    }
  });

  const historyData = {
    primaryGuest: signImages(guest.toObject ? guest.toObject() : guest),
    stayHistory: stayHistory.map(signImages),
    alerts,
    remarks,
  };

  res.status(200).json(new ApiResponse(200, historyData));
});

// --- 5. REMARKS (RESTORED) ---
const addRemark = asyncHandler(async (req, res) => {
  const guestId = req.params.id;
  const { text } = req.body;
  if (!text) {
    throw new ApiError(400, 'remark text is required');
  }

  const remark = await Remark.create({
    guest: guestId,
    officer: req.user._id,
    officerModel: 'Police',
    text,
  });

  // We populate just for the immediate response
  const populatedRemark = await remark.populate('officer', 'username');

  res.status(201).json(new ApiResponse(201, populatedRemark, 'remark added successfully'));
});

// --- 6. CASE REPORTS ---
const createCaseReport = asyncHandler(async (req, res) => {
  const { title, summary, guestId } = req.body;
  if (!title || !summary) {
    throw new ApiError(400, 'Title and summary are required');
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

const getCaseReports = asyncHandler(async (req, res) => {
  const reports = await CaseReport.find({ officer: req.user._id })
    .populate('officer', 'username rank')
    .populate('guest', 'primaryGuest.name')
    .sort({ createdAt: -1 });
  res.status(200).json(new ApiResponse(200, reports));
});

const getHotelList = asyncHandler(async (req, res) => {
  const hotels = await Hotel.find({ status: 'Active' }).select('hotelName city').sort('hotelName');
  res.status(200).json(new ApiResponse(200, hotels));
});

const advancedGuestSearch = asyncHandler(async (req, res) => {
  const { hotel, city, state, purposeOfVisit, dateFrom, dateTo } = req.body;

  let query = {};
  let hotelQuery = {};
  if (dateFrom || dateTo) {
    query.registrationTimestamp = {};
    if (dateFrom) query.registrationTimestamp.$gte = new Date(dateFrom);
    if (dateTo) query.registrationTimestamp.$lte = new Date(dateTo);
  }
  if (purposeOfVisit) {
    query['stayDetails.purposeOfVisit'] = new RegExp(purposeOfVisit, 'i');
  }
  if (hotel) {
    query.hotel = hotel;
  } else if (city || state) {
    if (city) hotelQuery.city = new RegExp(city, 'i');
    if (state) hotelQuery.state = new RegExp(state, 'i');

    const matchingHotels = await Hotel.find(hotelQuery).select('_id');
    const hotelIds = matchingHotels.map((h) => h._id);

    query.hotel = { $in: hotelIds };
  }
  const guests = await Guest.find(query)
    .populate('hotel', 'hotelName city')
    .sort({ registrationTimestamp: -1 })
    .limit(100);
  res.status(200).json(new ApiResponse(200, guests));
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
};
