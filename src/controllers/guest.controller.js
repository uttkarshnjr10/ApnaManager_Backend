// src/controllers/guest.controller.js
const mongoose = require('mongoose');
const Guest = require('../models/guest.model');
const Hotel = require('../models/hotel.model');
const AccessLog = require('../models/access-log.model');
const Watchlist = require('../models/watchlist.model');
const Alert = require('../models/alert.model');
const Notification = require('../models/notification.model');
const RegionalAdmin = require('../models/regional-admin.model');

const asyncHandler = require('express-async-handler');
const logger = require('../utils/logger');
const generateGuestPDF = require('../utils/pdf-generator');
const { generateGuestReportCSV } = require('../utils/report-generator');
const { sendCheckoutEmail } = require('../utils/send-email');
const ApiError = require('../utils/api-error');
const ApiResponse = require('../utils/api-response');
const { uploadToCloudinary, generateSignedUrl } = require('../utils/cloudinary');
const { getIO } = require('../config/socket');

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Calculate age from date of birth
 * @param {Date|string} dob - Date of birth
 * @returns {number} Age in years
 */
const calculateAge = (dob) => {
  if (!dob) return 99;
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
};

/**
 * Safely parse JSON string or return fallback value
 * @param {string|Object} value - Value to parse
 * @param {*} fallback - Fallback value if parsing fails
 * @returns {*} Parsed value or fallback
 */
const parseMaybeJson = (value, fallback) => {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value ?? fallback;
};

/**
 * Process and upload multiple files to Cloudinary in parallel
 * @param {Array} files - Array of multer files
 * @param {string} folder - Cloudinary folder name
 * @returns {Promise<Object>} Map of fieldname to upload result
 */
const processUploadedFiles = async (files, folder = 'guest-guard') => {
  if (!files || files.length === 0) {
    throw new ApiError(400, 'No files uploaded');
  }

  // OPTIMIZATION: Upload all files in parallel for speed
  const uploadPromises = files.map((file) => {
    return uploadToCloudinary(file, folder).catch((error) => {
      logger.error(`Upload failed for ${file.fieldname}: ${error.message}`);
      throw new ApiError(500, `Failed to upload ${file.fieldname}`);
    });
  });

  const uploadResults = await Promise.all(uploadPromises);

  // Map results by fieldname for easy access
  const filesMap = uploadResults.reduce((map, item) => {
    map[item.fieldname] = {
      url: item.url,
      public_id: item.public_id,
    };
    return map;
  }, {});

  return filesMap;
};

/**
 * Extract image objects from files map
 * @param {Object} filesMap - Map of uploaded files
 * @returns {Object} Object containing idImageFront, idImageBack, livePhoto
 * @throws {ApiError} If required images are missing
 */
const extractRequiredImages = (filesMap) => {
  const idImageFront = {
    url: filesMap['idImageFront']?.url,
    public_id: filesMap['idImageFront']?.public_id,
  };
  const idImageBack = {
    url: filesMap['idImageBack']?.url,
    public_id: filesMap['idImageBack']?.public_id,
  };
  const livePhoto = {
    url: filesMap['livePhoto']?.url,
    public_id: filesMap['livePhoto']?.public_id,
  };

  if (!idImageFront.url || !idImageBack.url || !livePhoto.url) {
    throw new ApiError(400, 'Image upload failed. Front, back, and live photos are required');
  }

  return { idImageFront, idImageBack, livePhoto };
};

/**
 * Build primary guest data from request body
 * @param {Object} body - Express request body
 * @returns {Object} Primary guest data object
 */
const buildPrimaryGuestData = (body) => {
  return {
    name: body.primaryGuestName,
    dob: body.primaryGuestDob,
    gender: body.primaryGuestGender,
    phone: body.primaryGuestPhone,
    email: body.primaryGuestEmail,
    address: {
      street: body.primaryGuestAddressStreet,
      city: body.primaryGuestAddressCity,
      state: body.primaryGuestAddressState,
      zipCode: body.primaryGuestAddressZipCode,
    },
    nationality: body.primaryGuestNationality,
  };
};

/**
 * Build stay details from request body
 * @param {Object} body - Express request body
 * @returns {Object} Stay details object
 */
const buildStayDetails = (body) => {
  return {
    purposeOfVisit: body.purposeOfVisit,
    checkIn: body.checkIn,
    expectedCheckout: body.expectedCheckout,
    roomNumber: body.roomNumber,
  };
};

/**
 * Process accompanying guests from request
 * @param {Array} accompanyingGuestsRaw - Raw accompanying guests data
 * @param {Object} filesMap - Map of uploaded files
 * @returns {Object} Object with adults and children arrays
 */
const processAccompanyingGuests = (accompanyingGuestsRaw, filesMap) => {
  const accompanyingGuests = { adults: [], children: [] };

  if (!accompanyingGuestsRaw || accompanyingGuestsRaw.length === 0) {
    return accompanyingGuests;
  }

  accompanyingGuestsRaw.forEach((guest, index) => {
    const processedGuest = {
      ...guest,
      idImageFront: filesMap[`accompanying_${index}_idImageFront`] || undefined,
      idImageBack: filesMap[`accompanying_${index}_idImageBack`] || undefined,
      livePhoto: filesMap[`accompanying_${index}_livePhoto`] || undefined,
    };

    if (!guest.dob) {
      accompanyingGuests.adults.push(processedGuest);
    } else {
      const age = calculateAge(guest.dob);
      age < 14
        ? accompanyingGuests.children.push(processedGuest)
        : accompanyingGuests.adults.push(processedGuest);
    }
  });

  return accompanyingGuests;
};

/**
 * Validate room availability
 * @param {Object} hotel - Hotel document
 * @param {string} roomNumber - Room number to check
 * @throws {ApiError} If room doesn't exist or is occupied
 */
const validateRoomAvailability = (hotel, roomNumber) => {
  if (!roomNumber) {
    throw new ApiError(400, 'Room number is required');
  }

  const room = hotel.rooms.find((r) => r.roomNumber === roomNumber);

  if (!room) {
    throw new ApiError(404, `Room "${roomNumber}" does not exist`);
  }

  if (room.status === 'Occupied') {
    throw new ApiError(400, `Room "${roomNumber}" is already occupied`);
  }

  return room;
};

/**
 * Atomically claim a room as Occupied.
 * Uses findOneAndUpdate with a query targeting status: 'Vacant' to prevent
 * TOCTOU race conditions when concurrent requests target the same room.
 *
 * @param {string} hotelId - Hotel document ID
 * @param {string} roomNumber - Room number to claim
 * @param {string} guestId - Guest ID to assign
 * @returns {Promise<Object>} Updated hotel document
 * @throws {ApiError} If room doesn't exist, is already occupied, or hotel not found
 */
const claimRoomAtomically = async (hotelId, roomNumber, guestId) => {
  if (!roomNumber) {
    throw new ApiError(400, 'Room number is required');
  }

  const updatedHotel = await Hotel.findOneAndUpdate(
    {
      _id: hotelId,
      'rooms.roomNumber': roomNumber,
      'rooms.status': 'Vacant',
    },
    {
      $set: {
        'rooms.$.status': 'Occupied',
        'rooms.$.guestId': guestId,
      },
    },
    { new: true }
  );

  if (!updatedHotel) {
    // Determine the specific error: room doesn't exist vs already occupied
    const hotel = await Hotel.findById(hotelId).select('rooms').lean();
    if (!hotel) throw new ApiError(404, 'Hotel not found');

    const room = hotel.rooms.find((r) => r.roomNumber === roomNumber);
    if (!room) throw new ApiError(404, `Room "${roomNumber}" does not exist`);
    throw new ApiError(400, `Room "${roomNumber}" is already occupied`);
  }

  return updatedHotel;
};

/**
 * Create date range for queries
 * @param {string} startDate - Start date string
 * @param {string} endDate - End date string
 * @returns {Object} Object with start and end Date objects
 * @throws {ApiError} If dates are invalid
 */
const createDateRange = (startDate, endDate) => {
  if (!startDate || !endDate) {
    throw new ApiError(400, 'Both "startDate" and "endDate" query parameters are required');
  }

  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  if (start > end) {
    throw new ApiError(400, 'startDate cannot be after endDate');
  }

  return { start, end };
};

// ============================================================
// BACKGROUND TASK: WATCHLIST CHECK
// ============================================================

/**
 * Build a lookup map of identifier → person info for everyone in a booking.
 * Enables O(1) identification of which person matched a watchlist entry.
 *
 * @param {Object} guest - Guest document
 * @returns {Map<string, {name: string, identifier: string, role: string}>}
 */
const buildPersonLookup = (guest) => {
  const map = new Map();

  // Primary guest — ID number
  if (guest.idNumber) {
    map.set(guest.idNumber, {
      name: guest.primaryGuest?.name || 'Unknown',
      identifier: guest.idNumber,
      role: 'Primary',
    });
  }

  // Primary guest — phone
  if (guest.primaryGuest?.phone) {
    map.set(guest.primaryGuest.phone, {
      name: guest.primaryGuest.name || 'Unknown',
      identifier: guest.primaryGuest.phone,
      role: 'Primary',
    });
  }

  // Accompanying adults
  const addFromArray = (arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((g) => {
      if (g.idNumber) {
        map.set(g.idNumber, {
          name: g.name || 'Unknown',
          identifier: g.idNumber,
          role: 'Accompanying',
        });
      }
    });
  };

  addFromArray(guest.accompanyingGuests?.adults);
  addFromArray(guest.accompanyingGuests?.children);

  return map;
};

/**
 * CRITICAL: Check watchlist against ALL persons in a booking and notify admins + hotel.
 * This function runs AFTER the HTTP response is sent to avoid blocking the user.
 * Uses Promise.all for parallel operations and batches notifications.
 *
 * @param {Object} guest - Guest document
 * @param {Object} hotel - Hotel document
 * @returns {Promise<void>}
 */
const checkWatchlistAndNotifyAsync = async (guest, hotel) => {
  try {
    // ── Step 1: Collect all identifiers from the booking ──
    const personLookup = buildPersonLookup(guest);
    const allValues = [...personLookup.keys()];

    if (allValues.length === 0) return;

    // ── Step 2: Find ALL watchlist matches ──
    const matches = await Watchlist.find({
      value: { $in: allValues },
    })
      .select('value reason type')
      .lean();

    if (!matches || matches.length === 0) return;

    // ── Step 3: Create an alert for EACH matched person ──
    const alertPromises = matches.map((match) => {
      const person = personLookup.get(match.value);
      const roleLabel = person.role === 'Primary' ? 'Primary Guest' : 'Accompanying Guest';

      logger.warn(
        `WATCHLIST MATCH: ${roleLabel} "${person.name}" (${match.type}: ${person.identifier}) ` +
          `in booking ${guest.customerId} at ${hotel.hotelName} (Reason: ${match.reason})`
      );

      return Alert.create({
        guest: guest._id,
        hotel: hotel._id,
        reason:
          `AUTOMATIC FLAG: ${roleLabel} "${person.name}" matched watchlist. ` +
          `Reason: "${match.reason}" (Match on: ${match.type})`,
        status: 'Open',
        matchedPerson: {
          name: person.name,
          identifier: person.identifier,
          role: person.role,
        },
      });
    });

    const alerts = await Promise.all(alertPromises);

    // ── Step 4: Populate alerts for socket payload ──
    const populatedAlerts = await Promise.all(
      alerts.map((a) =>
        Alert.findById(a._id)
          .populate('guest', 'primaryGuest.name idNumber stayDetails.roomNumber')
          .lean()
      )
    );

    // ── Step 5: Build notification message ──
    const matchSummaries = matches.map((match) => {
      const person = personLookup.get(match.value);
      const roleLabel = person.role === 'Primary' ? 'Primary' : 'Accompanying';
      return `${person.name} [${roleLabel}] (${match.reason})`;
    });

    const notificationMessage =
      `WATCHLIST MATCH at ${hotel.hotelName}: ` + matchSummaries.join('; ');

    // ── Step 6: Batch insert notifications for admins + hotel ──
    const admins = await RegionalAdmin.find({ status: 'Active' }).select('_id').lean();
    const adminNotifications = admins.map((admin) => ({
      recipientUser: admin._id,
      recipientModel: 'RegionalAdmin',
      message: notificationMessage,
      isRead: false,
    }));

    // Also notify the hotel itself
    const hotelNotification = {
      recipientUser: hotel._id,
      recipientModel: 'Hotel',
      message: notificationMessage,
      isRead: false,
    };

    await Notification.insertMany([...adminNotifications, hotelNotification]);
    logger.info(
      `Sent ${admins.length} admin + 1 hotel notification(s) for ${matches.length} watchlist match(es)`
    );

    // ── Step 7: Socket emit (non-blocking) ──
    try {
      const io = getIO();

      // Notify all platform admins
      io.to('admin_global').emit('NEW_ALERT', {
        type: 'WATCHLIST_HIT',
        message: notificationMessage,
        alerts: populatedAlerts,
        hotelName: hotel.hotelName,
        matchCount: matches.length,
        timestamp: new Date(),
      });

      // Notify the specific hotel
      io.to(`hotel_${hotel._id.toString()}`).emit('NEW_ALERT', {
        type: 'WATCHLIST_HIT',
        message: notificationMessage,
        alerts: populatedAlerts,
        matchCount: matches.length,
        timestamp: new Date(),
      });

      logger.info(`Socket events emitted for ${matches.length} watchlist match(es)`);
    } catch (socketError) {
      logger.error(`Socket emit failed: ${socketError.message}`);
    }
  } catch (error) {
    logger.error(`Watchlist check failed: ${error.message}`);
    // Don't throw - this is a background task
  }
};

/**
 * Wrapper to run watchlist check completely asynchronously.
 * Uses setImmediate to defer execution until after HTTP response.
 * @param {Object} guest - Guest document
 * @param {Object} hotel - Hotel document
 */
const triggerWatchlistCheck = (guest, hotel) => {
  setImmediate(() => {
    checkWatchlistAndNotifyAsync(guest, hotel).catch((error) => {
      logger.error(`Background watchlist check error: ${error.message}`);
    });
  });
};


// ============================================================
// CONTROLLER FUNCTIONS
// ============================================================

/**
 * Register a new guest
 * @desc Register guest with image uploads, room assignment, and background watchlist check
 * @route POST /api/guests/register
 * @access Private (Hotel staff only)
 */
const registerGuest = asyncHandler(async (req, res) => {
  const hotelUserId = req.user._id;

  // OPTIMIZATION: Fetch hotel with only needed fields
  const hotel = await Hotel.findById(hotelUserId).select('hotelName city pinCode rooms');

  if (!hotel) {
    throw new ApiError(404, 'Hotel user not found');
  }

  // STEP 1: Process file uploads in parallel (already optimized)
  const filesMap = await processUploadedFiles(req.files || []);
  logger.info(`Processed ${Object.keys(filesMap).length} files for guest registration`);

  // STEP 2: Extract and validate required images
  const { idImageFront, idImageBack, livePhoto } = extractRequiredImages(filesMap);

  // STEP 3: Build guest data from request
  const primaryGuestData = buildPrimaryGuestData(req.body);
  const stayDetailsData = buildStayDetails(req.body);

  // STEP 4: Process accompanying guests
  const accompanyingGuestsRaw = parseMaybeJson(req.body.accompanyingGuests, []);
  const accompanyingGuests = processAccompanyingGuests(accompanyingGuestsRaw, filesMap);

  // STEP 4.5: Parse and validate DPDP consent record
  const consentRecordRaw = parseMaybeJson(req.body.consentRecord, null);
  if (
    !consentRecordRaw ||
    !consentRecordRaw.consentGranted ||
    !consentRecordRaw.signatureImage ||
    !consentRecordRaw.consentHash ||
    !consentRecordRaw.signedAt
  ) {
    throw new ApiError(400, 'Valid guest consent record with signature is required under DPDP Act 2023');
  }

  const consentRecord = {
    signatureImage: consentRecordRaw.signatureImage,
    consentTextVersion: consentRecordRaw.consentTextVersion,
    consentHash: consentRecordRaw.consentHash,
    signedAt: new Date(consentRecordRaw.signedAt),
    consentGranted: true,
  };

  // STEP 5: Create guest document
  const guest = await Guest.create({
    primaryGuest: primaryGuestData,
    idType: req.body.idType,
    idNumber: req.body.idNumber,
    idImageFront,
    idImageBack,
    livePhoto,
    accompanyingGuests,
    stayDetails: stayDetailsData,
    hotel: hotelUserId,
    consentRecord,
  });

  // STEP 6: Atomically claim the room (prevents TOCTOU double-booking race condition)
  await claimRoomAtomically(hotelUserId, stayDetailsData.roomNumber, guest._id);

  // STEP 8: Send immediate response to user (don't wait for watchlist check)
  res.status(201).json(new ApiResponse(201, guest, 'Guest registered successfully'));

  // STEP 9: CRITICAL OPTIMIZATION: Trigger watchlist check asynchronously
  // This runs AFTER response is sent, doesn't block the user
  triggerWatchlistCheck(guest, hotel);

  logger.info(`Guest registered: ${guest.customerId} in room ${stayDetailsData.roomNumber}`);
});

/**
 * Get all guests for the hotel
 * @desc Retrieve all guests with total accompanying guests count
 * @route GET /api/guests/all
 * @access Private (Hotel staff only)
 */
const getAllGuests = asyncHandler(async (req, res) => {
  const hotelUserId = req.user._id;

  // OPTIMIZATION: Use aggregation with projection to reduce payload
  const guests = await Guest.aggregate([
    { $match: { hotel: new mongoose.Types.ObjectId(hotelUserId) } },
    {
      $addFields: {
        totalAccompanyingGuests: {
          $add: [
            { $size: '$accompanyingGuests.adults' },
            { $size: '$accompanyingGuests.children' },
          ],
        },
      },
    },
    // OPTIMIZATION: Project only needed fields to reduce memory usage
    {
      $project: {
        customerId: 1,
        'primaryGuest.name': 1,
        'primaryGuest.phone': 1,
        'primaryGuest.email': 1,
        idNumber: 1,
        'stayDetails.roomNumber': 1,
        'stayDetails.checkIn': 1,
        'stayDetails.expectedCheckout': 1,
        status: 1,
        registrationTimestamp: 1,
        totalAccompanyingGuests: 1,
      },
    },
    { $sort: { registrationTimestamp: -1 } },
  ]).allowDiskUse(true);

  res.status(200).json(new ApiResponse(200, guests, 'Guests retrieved successfully'));
});

/**
 * Get today's guests
 * @desc Retrieve guests registered today
 * @route GET /api/guests/today
 * @access Private (Hotel staff only)
 */
const getTodaysGuests = asyncHandler(async (req, res) => {
  const hotelUserId = req.user._id;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  // OPTIMIZATION: Use lean() for better performance, select only needed fields
  const guests = await Guest.find({
    hotel: hotelUserId,
    registrationTimestamp: { $gte: startOfToday, $lte: endOfToday },
  })
    .select('primaryGuest.name stayDetails.roomNumber customerId registrationTimestamp')
    .sort({ registrationTimestamp: -1 })
    .lean();

  res.status(200).json(new ApiResponse(200, guests, "Today's guests retrieved successfully"));
});

/**
 * Checkout a guest
 * @desc Checkout guest, generate PDF, send email, and vacate room
 * @route PUT /api/guests/:id/checkout
 * @access Private (Hotel staff only)
 */
const checkoutGuest = asyncHandler(async (req, res) => {
  const guestId = req.params.id;

  // OPTIMIZATION: Populate only needed hotel fields
  const guest = await Guest.findById(guestId).populate({
    path: 'hotel',
    model: 'Hotel',
    select: 'username email hotelName city rooms address phone',
  });

  if (!guest) {
    throw new ApiError(404, 'Guest not found');
  }

  // SECURITY: Verify the authenticated hotel owns this guest (prevents IDOR)
  if (guest.hotel._id.toString() !== req.user._id.toString()) {
    throw new ApiError(403, 'You are not authorized to checkout this guest');
  }

  if (guest.status === 'Checked-Out') {
    throw new ApiError(400, 'This guest has already been checked out');
  }

  // STEP 1: Update guest status
  guest.status = 'Checked-Out';
  guest.stayDetails.checkOut = new Date();
  await guest.save();

  // STEP 2: Vacate room (synchronous — must complete before response to prevent orphaned rooms)
  if (guest.hotel && guest.hotel.rooms) {
    const roomIndex = guest.hotel.rooms.findIndex(
      (r) => r.roomNumber === guest.stayDetails.roomNumber
    );
    if (roomIndex !== -1) {
      guest.hotel.rooms[roomIndex].status = 'Vacant';
      guest.hotel.rooms[roomIndex].guestId = null;
      await guest.hotel.save();
    }
  }

  // STEP 3: Create access log (non-blocking)
  AccessLog.create({
    user: req.user._id,
    userModel: 'Hotel',
    action: 'Guest Checkout',
    reason: `Checked out guest ${guest.primaryGuest.name}`,
  }).catch((error) => {
    logger.error(`Failed to create access log: ${error.message}`);
  });

  // STEP 4: Send response
  res.status(200).json(new ApiResponse(200, null, 'Guest checked out successfully'));

  // STEP 5: OPTIMIZATION: Generate PDF and send email asynchronously
  // CRITICAL: Convert to plain object so Mongoose sub-documents (accompanying guests)
  // spread correctly inside the PDF generator.
  const guestPlain = guest.toObject();

  setImmediate(() => {
    generateGuestPDF(guestPlain)
      .then((pdfBuffer) => {
        return sendCheckoutEmail(
          guestPlain.primaryGuest.email,
          guestPlain.hotel.email,
          guestPlain,
          pdfBuffer
        );
      })
      .then(() => {
        logger.info(`Checkout email sent to ${guestPlain.primaryGuest.email}`);
      })
      .catch((error) => {
        logger.error(`Checkout email/PDF failed: ${error.message}`);
      });
  });

  logger.info(`Guest checked out: ${guest.customerId}`);
});

/**
 * Get a single guest by ID with full details
 * @desc Retrieve complete guest data including accompanying guests and signed image URLs
 * @route GET /api/guests/:id
 * @access Private (Hotel staff only)
 */
const getGuestById = asyncHandler(async (req, res) => {
  const guestId = req.params.id;
  const hotelUserId = req.user._id;

  const guest = await Guest.findOne({ _id: guestId, hotel: hotelUserId }).lean();

  if (!guest) {
    throw new ApiError(404, 'Guest not found');
  }

  // Generate signed URLs for primary guest images
  const signImage = (field) => {
    if (!field || !field.public_id) return field;
    try {
      return { ...field, signedUrl: generateSignedUrl(field.public_id) };
    } catch {
      return field;
    }
  };

  guest.livePhoto = signImage(guest.livePhoto);
  guest.idImageFront = signImage(guest.idImageFront);
  guest.idImageBack = signImage(guest.idImageBack);

  // Sign accompanying guest images
  const signGuestImages = (guestArr) => {
    if (!Array.isArray(guestArr)) return [];
    return guestArr.map((g) => ({
      ...g,
      livePhoto: signImage(g.livePhoto),
      idImageFront: signImage(g.idImageFront),
      idImageBack: signImage(g.idImageBack),
    }));
  };

  if (guest.accompanyingGuests) {
    guest.accompanyingGuests.adults = signGuestImages(guest.accompanyingGuests.adults);
    guest.accompanyingGuests.children = signGuestImages(guest.accompanyingGuests.children);
  }

  res.status(200).json(new ApiResponse(200, guest, 'Guest details retrieved successfully'));
});

/**
 * Generate guest report CSV
 * @desc Generate CSV report of guests within date range
 * @route GET /api/guests/report?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * @access Private (Hotel staff only)
 */
const generateGuestReport = asyncHandler(async (req, res) => {
  const hotelUserId = req.user._id;
  const { startDate, endDate } = req.query;

  // Use helper function for date range validation
  const { start, end } = createDateRange(startDate, endDate);

  // OPTIMIZATION: Use lean() for better performance
  const guests = await Guest.find({
    hotel: hotelUserId,
    registrationTimestamp: { $gte: start, $lte: end },
  })
    .sort({ 'stayDetails.checkIn': 1 })
    .lean();

  if (!guests || guests.length === 0) {
    throw new ApiError(404, 'No guest records found for the selected date range');
  }

  // Generate CSV data
  const csvData = generateGuestReportCSV(guests);

  // Set response headers
  const fileName = `GuestReport_${startDate}_to_${endDate}.csv`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

  logger.info(`Guest report generated for ${req.user.username} with ${guests.length} records`);

  // Send CSV
  res.status(200).send(csvData);
});

module.exports = {
  registerGuest,
  getAllGuests,
  getTodaysGuests,
  checkoutGuest,
  getGuestById,
  generateGuestReport,
};
