// src/controllers/auth.controller.js
const Hotel = require('../models/Hotel.model');
const Police = require('../models/Police.model');
const RegionalAdmin = require('../models/RegionalAdmin.model');
const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const logger = require('../utils/logger');
const { client: redisClient } = require('../config/redisClient');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const crypto = require('crypto');
const { sendPasswordResetEmail } = require('../utils/sendEmail');

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
  RegionalAdmin: RegionalAdmin, // Alias for compatibility
};

/**
 * Finds a user by email across all user collections
 * @param {string} email - User's email address
 * @param {string} [loginType] - Optional hint for which collection to search first
 * @returns {Promise<{user: Object|null, role: string|null}>} User object and their role
 */
const findUserByEmail = async (email, loginType) => {
  // Fast path: Search specific collection if loginType is provided
  if (loginType && USER_MODELS[loginType]) {
    const user = await USER_MODELS[loginType].findOne({ email }).select('+password');
    return user
      ? { user, role: loginType === 'RegionalAdmin' ? 'Regional Admin' : loginType }
      : { user: null, role: null };
  }

  // Fallback: Search all collections in parallel
  const [hotel, police, admin] = await Promise.all([
    Hotel.findOne({ email }).select('+password'),
    Police.findOne({ email }).select('+password'),
    RegionalAdmin.findOne({ email }).select('+password'),
  ]);

  if (hotel) return { user: hotel, role: 'Hotel' };
  if (police) return { user: police, role: 'Police' };
  if (admin) return { user: admin, role: 'Regional Admin' };

  return { user: null, role: null };
};

/**
 * Generates JWT token for authenticated user
 * @param {string} id - User's MongoDB ID
 * @param {string} role - User's role (Hotel, Police, Regional Admin)
 * @param {string} username - User's username
 * @returns {string} JWT token
 */
const generateToken = (id, role, username) => {
  return jwt.sign({ id, role, username }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

/**
 * Cookie configuration for JWT
 * @constant {Object}
 */
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

/**
 * Extracts token from request (cookie or Authorization header)
 * @param {Object} req - Express request object
 * @returns {string|null} Extracted token or null
 */
const extractToken = (req) => {
  if (req.cookies?.jwt) {
    return req.cookies.jwt;
  }
  if (req.headers.authorization?.startsWith('Bearer')) {
    return req.headers.authorization.split(' ')[1];
  }
  return null;
};

/**
 * Blacklists a JWT token in Redis
 * @param {string} token - JWT token to blacklist
 * @returns {Promise<void>}
 */
const blacklistToken = async (token) => {
  try {
    const decoded = jwt.decode(token);
    if (decoded?.exp) {
      const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
      if (expiresIn > 0) {
        await redisClient.set(`blacklist:${token}`, 'true', { EX: expiresIn });
        logger.info('Token blacklisted successfully');
      }
    }
  } catch (error) {
    logger.error(`Token blacklist error: ${error.message}`);
    // Don't throw - blacklisting is a best-effort operation
  }
};

/**
 * Finds user by reset token across all collections
 * @param {string} hashedToken - Hashed reset token
 * @returns {Promise<Object|null>} User object or null
 */
const findUserByResetToken = async (hashedToken) => {
  const query = {
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  };

  const [hotel, police, admin] = await Promise.all([
    Hotel.findOne(query),
    Police.findOne(query),
    RegionalAdmin.findOne(query),
  ]);

  return hotel || police || admin || null;
};

// ============================================================
// CONTROLLER FUNCTIONS
// ============================================================

/**
 * Authenticate user and generate JWT token
 * @route POST /api/auth/login
 * @access Public
 * @param {Object} req.body - { email, password, loginType }
 * @returns {Promise<void>} JSON response with user data and token
 */
const loginUser = asyncHandler(async (req, res) => {
  const { email, password, loginType } = req.body;

  // Validation
  if (!email || !password) {
    throw new ApiError(400, 'Email and password are required');
  }

  // Find user
  const { user, role } = await findUserByEmail(email, loginType);

  // Verify credentials
  if (!user || !(await user.matchPassword(password))) {
    throw new ApiError(401, 'Invalid email or password');
  }

  // Check account status
  if (user.status === 'Suspended') {
    throw new ApiError(403, 'Your account has been suspended. Please contact support.');
  }

  // Check if password change is required
  if (user.passwordChangeRequired) {
    logger.warn(`Login attempt for user requiring password change: ${user.email}`);
    return res
      .status(202)
      .json(
        new ApiResponse(202, { userId: user._id, role }, 'Password change required before login')
      );
  }

  // Generate token
  const token = generateToken(user._id, role, user.username);

  // Set cookie
  res.cookie('jwt', token, cookieOptions);

  // Prepare response data
  const userData = {
    _id: user._id,
    username: user.username,
    email: user.email,
    role: role,
    token: token, // Also send in response for localStorage fallback
  };

  logger.info(`Successful login: ${role} - ${user.email} (Type: ${loginType || 'Auto'})`);
  res.status(200).json(new ApiResponse(200, userData, 'Login successful'));
});

/**
 * Logout user and blacklist their token
 * @route POST /api/auth/logout
 * @access Private
 * @returns {Promise<void>} Success message
 */
const logoutUser = asyncHandler(async (req, res) => {
  const token = extractToken(req);

  // Blacklist token if present
  if (token) {
    await blacklistToken(token);
  }

  // Clear cookie
  res.cookie('jwt', '', {
    ...cookieOptions,
    maxAge: 0,
    expires: new Date(0),
  });

  logger.info(`User logged out successfully`);
  res.status(200).json(new ApiResponse(200, null, 'Logged out successfully'));
});

/**
 * Send password reset email to user
 * @route POST /api/auth/forgot-password
 * @access Public
 * @param {Object} req.body - { email }
 * @returns {Promise<void>} Success message (same for security whether email exists or not)
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    throw new ApiError(400, 'Please provide an email address');
  }

  // Find user
  const { user } = await findUserByEmail(email);

  // Security: Always return success message (don't reveal if email exists)
  const successMessage = 'If an account exists with this email, a reset link has been sent';

  if (!user) {
    logger.warn(`Password reset requested for non-existent email: ${email}`);
    return res.status(200).json(new ApiResponse(200, null, successMessage));
  }

  // Generate reset token
  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  // Prepare reset URL
  const frontendUrl = process.env.CORS_ALLOWED_ORIGINS?.split(',')[0] || 'http://localhost:5173';
  const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

  try {
    await sendPasswordResetEmail(user.email, user.username, resetUrl);
    logger.info(`Password reset email sent to: ${user.email}`);
    res.status(200).json(new ApiResponse(200, null, successMessage));
  } catch (error) {
    // Rollback reset token on email failure
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

    logger.error(`Failed to send password reset email to ${user.email}: ${error.message}`);
    throw new ApiError(500, 'Failed to send password reset email. Please try again later.');
  }
});

/**
 * Reset user password using reset token
 * @route POST /api/auth/reset-password
 * @access Public
 * @param {Object} req.body - { token, newPassword }
 * @returns {Promise<void>} Success message
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;

  // Validation
  if (!token || !newPassword) {
    throw new ApiError(400, 'Reset token and new password are required');
  }

  if (newPassword.length < 6) {
    throw new ApiError(400, 'Password must be at least 6 characters long');
  }

  // Hash token to match stored version
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  // Find user by reset token
  const user = await findUserByResetToken(hashedToken);

  if (!user) {
    throw new ApiError(400, 'Reset token is invalid or has expired');
  }

  // Update password and clear reset token
  user.password = newPassword;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  user.passwordChangeRequired = false;
  await user.save();

  logger.info(`Password reset successful for user: ${user.email}`);
  res
    .status(200)
    .json(new ApiResponse(200, null, 'Password reset successfully. You can now login.'));
});

/**
 * Force password change for users with passwordChangeRequired flag
 * @route POST /api/auth/change-password
 * @access Public (but protected by passwordChangeRequired flag)
 * @param {Object} req.body - { userId, newPassword }
 * @returns {Promise<void>} Success message
 */
const forceChangePassword = asyncHandler(async (req, res) => {
  const { userId, newPassword } = req.body;

  // Validation
  if (!userId || !newPassword) {
    throw new ApiError(400, 'User ID and new password are required');
  }

  if (newPassword.length < 6) {
    throw new ApiError(400, 'Password must be at least 6 characters long');
  }

  // Find user in any collection
  let user = await Hotel.findById(userId).select('+password');
  if (!user) user = await Police.findById(userId).select('+password');
  if (!user) user = await RegionalAdmin.findById(userId).select('+password');

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  // CRITICAL SECURITY CHECK: Only allow if passwordChangeRequired is true
  if (!user.passwordChangeRequired) {
    logger.warn(`Unauthorized force password change attempt for user: ${user.email}`);
    throw new ApiError(403, 'Password change is not required. Please login normally.');
  }

  // Update password
  user.password = newPassword;
  user.passwordChangeRequired = false;
  await user.save();

  logger.info(`Forced password change successful for user: ${user.email}`);
  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        null,
        'Password updated successfully. Please login with your new password.'
      )
    );
});

module.exports = {
  loginUser,
  logoutUser,
  forgotPassword,
  resetPassword,
  forceChangePassword,
};
