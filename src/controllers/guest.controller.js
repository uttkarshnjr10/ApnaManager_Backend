// src/controllers/guest.controller.js
const mongoose = require('mongoose');
const Guest = require('../models/Guest.model');
const Hotel = require('../models/Hotel.model');
const Police = require('../models/Police.model');
const AccessLog = require('../models/AccessLog.model');
const Watchlist = require('../models/Watchlist.model');
const Alert = require('../models/Alert.model');
const Notification = require('../models/Notification.model');
const PoliceStation = require('../models/PoliceStation.model');
const RegionalAdmin = require('../models/RegionalAdmin.model');

const asyncHandler = require('express-async-handler');
const logger = require('../utils/logger');
const generateGuestPDF = require('../utils/pdfGenerator');
const { generateGuestReportCSV } = require('../utils/reportGenerator');
const { sendCheckoutEmail } = require('../utils/sendEmail');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { uploadToCloudinary } = require('../utils/cloudinary');
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
 * Update room status to occupied
 * @param {Object} hotel - Hotel document
 * @param {string} roomNumber - Room number to update
 * @param {string} guestId - Guest ID to assign
 * @returns {Promise<Object>} Updated hotel document
 */
const updateRoomStatus = async (hotel, roomNumber, guestId) => {
  const room = hotel.rooms.find((r) => r.roomNumber === roomNumber);
  if (room) {
    room.status = 'Occupied';
    room.guestId = guestId;
    await hotel.save();
  }
  return hotel;
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
 * CRITICAL OPTIMIZATION: Check watchlist and notify police asynchronously
 * This function runs AFTER the HTTP response is sent to avoid blocking the user
 * Uses Promise.all for parallel operations and batches notifications
 *
 * @param {Object} guest - Guest document
 * @param {Object} hotel - Hotel document
 * @returns {Promise<void>}
 */
const checkWatchlistAndNotifyAsync = async (guest, hotel) => {
  try {
    const idNumber = guest.idNumber;
    const phone = guest.primaryGuest.phone;

    // OPTIMIZATION: Single query with $or instead of multiple queries
    const match = await Watchlist.findOne({
      $or: [{ value: idNumber }, { value: phone }],
    })
      .select('reason type addedBy addedByModel') // Only select needed fields
      .populate('addedBy', 'username')
      .lean(); // Use lean for better performance

    if (!match) {
      return; // No match, exit early
    }

    logger.warn(
      `WATCHLIST MATCH: Guest ${guest.primaryGuest.name} (ID: ${idNumber}) matched watchlist (Reason: ${match.reason})`
    );

    const hotelPincode = hotel.pinCode;
    if (!hotelPincode) {
      logger.error(`Hotel ${hotel.hotelName} has no pincode. Cannot notify police.`);
      return;
    }

    // OPTIMIZATION: Run station lookup and alert creation in parallel
    const [station, alert] = await Promise.all([
      PoliceStation.findOne({ pincodes: hotelPincode }).select('_id name city').lean(),
      Alert.create({
        guest: guest._id,
        reason: `AUTOMATIC FLAG: Guest matched watchlist. Reason: "${match.reason}" (Match on: ${match.type})`,
        createdBy: match.addedBy._id,
        creatorModel: match.addedByModel,
        status: 'Open',
      }),
    ]);

    if (!station) {
      logger.warn(`No police station found with jurisdiction over pincode ${hotelPincode}`);
      return;
    }

    // OPTIMIZATION: Get officers and populate alert in parallel
    const [officers, populatedAlert] = await Promise.all([
      Police.find({ policeStation: station._id })
        .select('_id') // Only need IDs for notifications
        .lean(),
      Alert.findById(alert._id)
        .populate('guest', 'primaryGuest.name idNumber stayDetails.roomNumber')
        .lean(),
    ]);

    if (!officers || officers.length === 0) {
      logger.warn(`No officers found for station ${station.name}`);
      return;
    }

    const notificationMessage = `WATCHLIST MATCH: ${guest.primaryGuest.name} checked into ${hotel.hotelName} (Reason: ${match.reason})`;

    // CRITICAL OPTIMIZATION: Batch insert notifications instead of creating one by one
    const notificationDocs = officers.map((officer) => ({
      recipientStation: station._id,
      recipientUser: officer._id,
      recipientModel: 'Police',
      message: notificationMessage,
      isRead: false,
    }));

    // Also notify all Regional Admins
    const admins = await RegionalAdmin.find({ status: 'Active' }).select('_id').lean();
    const adminNotifications = admins.map((admin) => ({
      recipientUser: admin._id,
      recipientModel: 'RegionalAdmin',
      message: notificationMessage,
      isRead: false,
    }));

    await Notification.insertMany([...notificationDocs, ...adminNotifications]);
    logger.info(
      `Sent ${officers.length} police + ${admins.length} admin notifications about watchlist match`
    );

    // OPTIMIZATION: Socket emit in non-blocking way (already in try-catch)
    try {
      const io = getIO();
      const stationRoom = `station_${station._id.toString()}`;

      // Emit to specific police station room
      io.to(stationRoom).emit('NEW_ALERT', {
        type: 'WATCHLIST_HIT',
        message: notificationMessage,
        alert: populatedAlert,
        hotelName: hotel.hotelName,
        timestamp: new Date(),
      });

      // Emit to global admin room
      io.to('admin_global').emit('NEW_ALERT', {
        type: 'WATCHLIST_HIT_ADMIN',
        message: `CRITICAL: Watchlist hit in ${station.city}`,
        alert: populatedAlert,
        stationName: station.name,
        timestamp: new Date(),
      });

      logger.info(`Socket events emitted for watchlist match`);
    } catch (socketError) {
      logger.error(`Socket emit failed: ${socketError.message}`);
      // Don't throw - socket failures shouldn't break the notification flow
    }
  } catch (error) {
    logger.error(`Watchlist check failed: ${error.message}`);
    // Don't throw - this is a background task
  }
};

/**
 * Wrapper to run watchlist check completely asynchronously
 * Uses setImmediate to defer execution until after HTTP response
 * @param {Object} guest - Guest document
 * @param {Object} hotel - Hotel document
 */
const triggerWatchlistCheck = (guest, hotel) => {
  // CRITICAL: Use setImmediate to completely decouple from request lifecycle
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

  // STEP 4: Validate room availability (throws if invalid)
  validateRoomAvailability(hotel, stayDetailsData.roomNumber);

  // STEP 5: Process accompanying guests
  const accompanyingGuestsRaw = parseMaybeJson(req.body.accompanyingGuests, []);
  const accompanyingGuests = processAccompanyingGuests(accompanyingGuestsRaw, filesMap);

  // STEP 6: Create guest document
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
  });

  // STEP 7: Update room status (run in parallel with response preparation)
  // Using updateRoomStatus helper for better error handling
  updateRoomStatus(hotel, stayDetailsData.roomNumber, guest._id).catch((error) => {
    logger.error(`Failed to update room status: ${error.message}`);
    // Don't throw - guest is already created, room update is secondary
  });

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

  if (guest.status === 'Checked-Out') {
    throw new ApiError(400, 'This guest has already been checked out');
  }

  // STEP 1: Update guest status
  guest.status = 'Checked-Out';
  guest.stayDetails.checkOut = new Date();
  await guest.save();

  // STEP 2: Vacate room (run in background to not block response)
  if (guest.hotel && guest.hotel.rooms) {
    // Don't await - run asynchronously
    setImmediate(() => {
      Hotel.findById(guest.hotel._id)
        .then((hotel) => {
          if (hotel) {
            const roomIndex = hotel.rooms.findIndex(
              (r) => r.roomNumber === guest.stayDetails.roomNumber
            );
            if (roomIndex !== -1) {
              hotel.rooms[roomIndex].status = 'Vacant';
              hotel.rooms[roomIndex].guestId = null;
              return hotel.save();
            }
          }
        })
        .catch((error) => {
          logger.error(`Failed to vacate room: ${error.message}`);
        });
    });
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

  // STEP 4: Send response immediately (don't wait for email)
  res.status(200).json(new ApiResponse(200, null, 'Guest checked out successfully'));

  // STEP 5: OPTIMIZATION: Generate PDF and send email asynchronously
  setImmediate(() => {
    generateGuestPDF(guest)
      .then((pdfBuffer) => {
        return sendCheckoutEmail(
          guest.primaryGuest.email,
          guest.primaryGuest.name,
          guest.hotel.hotelName,
          pdfBuffer
        );
      })
      .then(() => {
        logger.info(`Checkout email sent to ${guest.primaryGuest.email}`);
      })
      .catch((error) => {
        logger.error(`Checkout email/PDF failed: ${error.message}`);
      });
  });

  logger.info(`Guest checked out: ${guest.customerId}`);
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
  generateGuestReport,
};
