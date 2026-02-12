// src/controllers/user.controller.js
const Hotel = require('../models/Hotel.model');
const Police = require('../models/Police.model');
const RegionalAdmin = require('../models/RegionalAdmin.model');
const HotelInquiry = require('../models/HotelInquiry.model');
const AccessLog = require('../models/AccessLog.model');
const Guest = require('../models/Guest.model');

const asyncHandler = require('express-async-handler');
const logger = require('../utils/logger');
const { sendCredentialsEmail } = require('../utils/sendEmail');
const { generateDailySummary } = require('../utils/aiService');
const crypto = require('crypto');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const NodeCache = require('node-cache');

// Initialize Cache (1 hour TTL)
const reportCache = new NodeCache({ stdTTL: 3600 });

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Model mapping for user roles
 * @constant {Object}
 */
const USER_MODELS = {
  Hotel: Hotel,
  Police: Police,
  'Regional Admin': RegionalAdmin,
};

/**
 * Checks if an email exists in any user collection
 * @param {string} email - Email address to check
 * @returns {Promise<Object|null>} User object if found, null otherwise
 */
const checkEmailExists = async (email) => {
  const [hotel, police, admin] = await Promise.all([
    Hotel.findOne({ email }),
    Police.findOne({ email }),
    RegionalAdmin.findOne({ email }),
  ]);
  return hotel || police || admin || null;
};

/**
 * Finds a user by ID across all collections
 * @param {string} id - User's MongoDB ID
 * @returns {Promise<{user: Object|null, model: Object|null, role: string|null}>} User data
 */
const findAnyUserById = async (id) => {
  let user = await Hotel.findById(id);
  if (user) return { user, model: Hotel, role: 'Hotel' };

  user = await Police.findById(id);
  if (user) return { user, model: Police, role: 'Police' };

  user = await RegionalAdmin.findById(id);
  if (user) return { user, model: RegionalAdmin, role: 'Regional Admin' };

  return { user: null, model: null, role: null };
};

/**
 * Gets Model class from user role
 * @param {string} role - User role
 * @returns {Object} Mongoose Model
 * @throws {ApiError} If role is invalid
 */
const getModelFromRole = (role) => {
  const model = USER_MODELS[role];
  if (!model) {
    throw new ApiError(400, 'Invalid user role');
  }
  return model;
};

/**
 * Generates a temporary password
 * @returns {string} Random password
 */
const generateTemporaryPassword = () => {
  return crypto.randomBytes(8).toString('hex');
};

/**
 * Removes sensitive fields from user object
 * @param {Object} userObject - User object (plain JS object)
 * @returns {Object} Sanitized user object
 */
const sanitizeUser = (userObject) => {
  delete userObject.password;
  delete userObject.passwordResetToken;
  delete userObject.passwordResetExpires;
  return userObject;
};

/**
 * Gets top N items from an array by frequency
 * @param {Array} items - Array of items
 * @param {number} [limit=3] - Number of top items to return
 * @returns {Array<string>} Top items
 */
const getTopItems = (items, limit = 3) => {
  if (!items || items.length === 0) return [];

  const counts = {};
  items.forEach((item) => {
    if (item) counts[item] = (counts[item] || 0) + 1;
  });

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([item]) => item);
};

// ============================================================
// CONTROLLER FUNCTIONS
// ============================================================

/**
 * Register a new user (Hotel, Police, or Regional Admin)
 * @route POST /api/users/register
 * @access Private/Admin
 * @param {Object} req.body - { username, email, role, details, policeStation }
 * @returns {Promise<void>} Created user credentials
 */
const registerUser = asyncHandler(async (req, res) => {
  const { username, email, role, details, policeStation } = req.body;

  // Validation
  if (!username || !email || !role) {
    throw new ApiError(400, 'Username, email, and role are required');
  }

  // Check email uniqueness
  if (await checkEmailExists(email)) {
    throw new ApiError(400, 'User with this email already exists');
  }

  // Generate temporary password
  const temporaryPassword = generateTemporaryPassword();

  const commonData = {
    username,
    email,
    password: temporaryPassword,
    passwordChangeRequired: true,
  };

  let user;

  // Create user in appropriate collection
  if (role === 'Hotel') {
    const hotelData = {
      ...commonData,
      hotelName: details?.hotelName,
      ownerName: details?.ownerName,
      gstNumber: details?.gstNumber,
      phone: details?.phone,
      address: details?.address,
      city: details?.city,
      state: details?.state,
      pinCode: details?.pinCode,
      nationality: details?.nationality || 'Indian',
      postOffice: details?.postOffice,
      localThana: details?.localThana,
      pinLocation: details?.pinLocation,
      ownerSignature: details?.ownerSignature,
      hotelStamp: details?.hotelStamp,
      aadhaarCard: details?.aadhaarCard,
    };
    user = await Hotel.create(hotelData);

    // Update inquiry status if exists
    try {
      await HotelInquiry.findOneAndUpdate(
        { email: user.email },
        { status: 'approved' },
        { new: true }
      );
      logger.info(`Inquiry for ${user.email} marked as approved`);
    } catch (inquiryError) {
      logger.error(`Failed to update inquiry for ${user.email}: ${inquiryError.message}`);
    }
  } else if (role === 'Police') {
    if (!policeStation) {
      throw new ApiError(400, 'Police station is required for police users');
    }
    user = await Police.create({ ...commonData, ...details, policeStation });
  } else if (role === 'Regional Admin') {
    user = await RegionalAdmin.create({ ...commonData, ...details });
  } else {
    throw new ApiError(400, 'Invalid user role specified');
  }

  // Send credentials email
  try {
    await sendCredentialsEmail(user.email, user.username, temporaryPassword);
    logger.info(`Credentials email sent to ${user.email}`);
  } catch (emailError) {
    logger.error(`Failed to send email to ${user.email}: ${emailError.message}`);
    // Don't rollback user creation
  }

  logger.info(`New ${role} created by admin ${req.user.username}: ${user.email}`);

  const responseData = {
    message: 'User created successfully. Credentials have been emailed.',
    username: user.username,
    password: temporaryPassword,
  };

  res.status(201).json(new ApiResponse(201, responseData, 'User created successfully'));
});

/**
 * Get current user's profile
 * @route GET /api/users/profile
 * @access Private
 * @returns {Promise<void>} User profile data
 */
const getUserProfile = asyncHandler(async (req, res) => {
  // Convert to plain object
  const userObject = req.user.toObject ? req.user.toObject() : { ...req.user };

  // Add role (from middleware)
  userObject.role = req.user.role;

  // Remove sensitive data
  const sanitizedUser = sanitizeUser(userObject);

  res.status(200).json(new ApiResponse(200, sanitizedUser, 'Profile retrieved successfully'));
});

/**
 * Update current user's profile
 * @route PUT /api/users/profile
 * @access Private
 * @param {Object} req.body - { email, details }
 * @returns {Promise<void>} Updated user profile
 */
const updateUserProfile = asyncHandler(async (req, res) => {
  const { role } = req.user;
  const userId = req.user._id;

  // Get appropriate model
  const Model = getModelFromRole(role);

  // Find user
  const user = await Model.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  // Update email if provided
  if (req.body.email) {
    // Check if new email already exists
    const existingUser = await checkEmailExists(req.body.email);
    if (existingUser && existingUser._id.toString() !== userId.toString()) {
      throw new ApiError(400, 'Email already in use by another account');
    }
    user.email = req.body.email;
  }

  // Update role-specific details
  if (req.body.details) {
    Object.keys(req.body.details).forEach((key) => {
      user[key] = req.body.details[key];
    });
  }

  const updatedUser = await user.save();

  // Sanitize response
  const userObject = updatedUser.toObject();
  const sanitizedUser = sanitizeUser(userObject);
  sanitizedUser.role = role; // Add back role

  logger.info(`Profile updated for user: ${user.email}`);
  res.status(200).json(new ApiResponse(200, sanitizedUser, 'Profile updated successfully'));
});

/**
 * Update current user's password
 * @route PUT /api/users/change-password
 * @access Private
 * @param {Object} req.body - { oldPassword, newPassword }
 * @returns {Promise<void>} Success message
 */
const updateUserPassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  // Validation
  if (!oldPassword || !newPassword) {
    throw new ApiError(400, 'Both old and new passwords are required');
  }

  if (newPassword.length < 6) {
    throw new ApiError(400, 'New password must be at least 6 characters long');
  }

  // Get model and fetch user with password
  const Model = getModelFromRole(req.user.role);
  const user = await Model.findById(req.user._id).select('+password');

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  // Verify old password
  if (!(await user.matchPassword(oldPassword))) {
    throw new ApiError(401, 'Current password is incorrect');
  }

  // Update password
  user.password = newPassword;
  user.passwordChangeRequired = false;
  await user.save();

  logger.info(`Password updated for user: ${user.email}`);
  res.status(200).json(new ApiResponse(200, null, 'Password updated successfully'));
});

/**
 * Get admin dashboard metrics
 * @route GET /api/users/admin/dashboard
 * @access Private/Admin
 * @returns {Promise<void>} Dashboard data
 */
const getAdminDashboardData = asyncHandler(async (req, res) => {
  // Count users in each collection
  const [hotelCount, policeCount] = await Promise.all([
    Hotel.countDocuments(),
    Police.countDocuments(),
  ]);

  // Get today's date range
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  // Count today's activities
  const [guestRegistrationsToday, policeSearchesToday] = await Promise.all([
    Guest.countDocuments({
      registrationTimestamp: { $gte: startOfDay, $lte: endOfDay },
    }),
    AccessLog.countDocuments({
      timestamp: { $gte: startOfDay, $lte: endOfDay },
      userModel: 'Police',
      action: { $regex: /search/i },
    }),
  ]);

  // Get recent users
  const [recentHotels, recentPolice] = await Promise.all([
    Hotel.find().sort({ createdAt: -1 }).limit(5).select('username city hotelName status').lean(),
    Police.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select('username station jurisdiction status')
      .lean(),
  ]);

  const dashboardData = {
    metrics: {
      hotels: hotelCount,
      police: policeCount,
      guestsToday: guestRegistrationsToday,
      searchesToday: policeSearchesToday,
    },
    users: {
      hotels: recentHotels,
      police: recentPolice,
    },
  };

  res.status(200).json(new ApiResponse(200, dashboardData, 'Dashboard data retrieved'));
});

/**
 * Get AI-generated daily report
 * @route GET /api/users/admin/ai-report
 * @access Private (Admin/Hotel)
 * @returns {Promise<void>} AI summary and statistics
 */
const getAIDailyReport = asyncHandler(async (req, res) => {
  const role = req.user.role || 'Hotel';
  const userId = req.user._id;

  // Cache key unique to user
  const cacheKey = `ai_report_${userId}`;
  const cachedReport = reportCache.get(cacheKey);

  if (cachedReport) {
    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { summary: cachedReport, source: 'cache' },
          'Report retrieved from cache'
        )
      );
  }

  // Define date range (today)
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  let statsPayload = {};

  // Role-based data fetching
  if (role === 'Regional Admin') {
    // Admin sees all data
    const guestsToday = await Guest.find({
      registrationTimestamp: { $gte: startOfDay, $lte: endOfDay },
    }).select('primaryGuest stayDetails');

    const policeSearches = await AccessLog.countDocuments({
      timestamp: { $gte: startOfDay, $lte: endOfDay },
      userModel: 'Police',
      action: { $regex: /search/i },
    });

    statsPayload = {
      totalGuests: guestsToday.length,
      foreignNationals: guestsToday.filter((g) => g.primaryGuest?.nationality !== 'Indian').length,
      topCities: getTopItems(guestsToday.map((g) => g.primaryGuest?.address?.city).filter(Boolean)),
      topPurposes: getTopItems(
        guestsToday.map((g) => g.stayDetails?.purposeOfVisit).filter(Boolean)
      ),
      policeSearches,
    };
  } else if (role === 'Hotel') {
    // Hotel sees only their data
    const guestsToday = await Guest.find({
      hotel: userId,
      registrationTimestamp: { $gte: startOfDay, $lte: endOfDay },
    }).select('primaryGuest stayDetails');

    statsPayload = {
      totalGuests: guestsToday.length,
      foreignNationals: guestsToday.filter((g) => g.primaryGuest?.nationality !== 'Indian').length,
      topCities: getTopItems(guestsToday.map((g) => g.primaryGuest?.address?.city).filter(Boolean)),
      topPurposes: getTopItems(
        guestsToday.map((g) => g.stayDetails?.purposeOfVisit).filter(Boolean)
      ),
    };
  } else {
    throw new ApiError(403, 'AI reporting is not available for your role');
  }

  // Generate AI summary
  const summary = await generateDailySummary(statsPayload, role);

  // Cache if successful
  if (!summary.includes('unavailable')) {
    reportCache.set(cacheKey, summary);
  }

  logger.info(`AI report generated for ${role}: ${userId}`);
  res
    .status(200)
    .json(new ApiResponse(200, { summary, source: 'live' }, 'Report generated successfully'));
});

/**
 * Get list of hotel users with optional filtering
 * @route GET /api/users/admin/hotels
 * @access Private/Admin
 * @param {Object} req.query - { searchTerm, status }
 * @returns {Promise<void>} List of hotels
 */
const getHotelUsers = asyncHandler(async (req, res) => {
  const { searchTerm, status } = req.query;
  const query = {};

  if (status && status !== 'All') {
    query.status = status;
  }

  if (searchTerm) {
    const regex = new RegExp(searchTerm, 'i');
    query.$or = [{ username: regex }, { city: regex }, { hotelName: regex }];
  }

  const hotels = await Hotel.find(query).lean();
  res.status(200).json(new ApiResponse(200, hotels, 'Hotels retrieved successfully'));
});

/**
 * Get list of police users with optional filtering
 * @route GET /api/users/police
 * @access Private/Admin
 * @param {Object} req.query - { searchTerm, status }
 * @returns {Promise<void>} List of police users
 */
const getPoliceUsers = asyncHandler(async (req, res) => {
  const { searchTerm, status } = req.query;
  const query = {};

  if (status && status !== 'All') {
    query.status = status;
  }

  if (searchTerm) {
    const regex = new RegExp(searchTerm, 'i');
    query.$or = [{ username: regex }, { station: regex }, { jurisdiction: regex }];
  }

  const policeUsers = await Police.find(query).lean();
  res.status(200).json(new ApiResponse(200, policeUsers, 'Police users retrieved successfully'));
});

/**
 * Update user status (Active/Suspended)
 * @route PUT /api/users/:id/status
 * @access Private/Admin
 * @param {Object} req.body - { status }
 * @returns {Promise<void>} Updated user
 */
const updateUserStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;

  // Validation
  if (!status || !['Active', 'Suspended'].includes(status)) {
    throw new ApiError(400, 'Valid status (Active or Suspended) is required');
  }

  // Find user
  const { user, model } = await findAnyUserById(req.params.id);

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  // Update status
  user.status = status;
  const updatedUser = await user.save();

  logger.info(`Admin ${req.user.username} updated status for ${user.username} to ${status}`);

  // Sanitize response
  const userObject = updatedUser.toObject();
  const sanitizedUser = sanitizeUser(userObject);

  res.status(200).json(new ApiResponse(200, sanitizedUser, 'User status updated successfully'));
});

/**
 * Delete a user
 * @route DELETE /api/users/:id
 * @access Private/Admin
 * @returns {Promise<void>} Success message
 */
const deleteUser = asyncHandler(async (req, res) => {
  const userId = req.params.id;

  // Find user
  const { user, model, role } = await findAnyUserById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  // Delete user
  await model.findByIdAndDelete(userId);

  logger.info(`Admin ${req.user.username} deleted user ${user.username} (${role})`);

  // Hotel-specific cleanup
  if (role === 'Hotel' && user.email) {
    try {
      await HotelInquiry.findOneAndUpdate(
        { email: user.email },
        { status: 'pending' },
        { new: true }
      );
      logger.info(`Inquiry for ${user.email} marked as pending`);
    } catch (inquiryError) {
      logger.error(`Failed to update inquiry: ${inquiryError.message}`);
    }
  }

  res.status(200).json(new ApiResponse(200, null, 'User deleted successfully'));
});

/**
 * Get access logs with optional filtering
 * @route GET /api/users/admin/logs
 * @access Private/Admin
 * @param {Object} req.query - { searchTerm }
 * @returns {Promise<void>} List of access logs
 */
const getAccessLogs = asyncHandler(async (req, res) => {
  const { searchTerm } = req.query;
  let query = {};

  if (searchTerm) {
    const regex = new RegExp(searchTerm, 'i');

    // Find matching users
    const [hotels, police, admins] = await Promise.all([
      Hotel.find({ username: regex }).select('_id'),
      Police.find({ username: regex }).select('_id'),
      RegionalAdmin.find({ username: regex }).select('_id'),
    ]);

    const userIds = [...hotels, ...police, ...admins].map((u) => u._id);

    query.$or = [
      { action: regex },
      { reason: regex },
      { searchQuery: regex },
      { user: { $in: userIds } },
    ];
  }

  // Fetch and populate logs
  const logs = await AccessLog.find(query)
    .populate('user', 'username role')
    .sort({ timestamp: -1 })
    .lean();

  res.status(200).json(new ApiResponse(200, logs, 'Access logs retrieved successfully'));
});

module.exports = {
  registerUser,
  getUserProfile,
  updateUserProfile,
  updateUserPassword,
  getAdminDashboardData,
  getAIDailyReport,
  getHotelUsers,
  getPoliceUsers,
  updateUserStatus,
  deleteUser,
  getAccessLogs,
};
