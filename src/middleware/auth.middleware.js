// src/middleware/auth.middleware.js
const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const Hotel = require('../models/Hotel.model');
const Police = require('../models/Police.model');
const RegionalAdmin = require('../models/RegionalAdmin.model');
const logger = require('../utils/logger');
const { client: redisClient } = require('../config/redisClient');
const ApiError = require('../utils/ApiError');

const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.cookies && req.cookies.jwt) {
    token = req.cookies.jwt;
  } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(new ApiError(401, 'Not authorized, no token provided'));
  }

  try {
    // 1. Check Blacklist
    const isBlacklisted = await redisClient.get(`blacklist:${token}`);
    if (isBlacklisted) {
      res.clearCookie('jwt');
      return next(new ApiError(401, 'Session expired. Please log in again.'));
    }

    // 2. Verify Token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 3. Find User based on ROLE in token
    let user;
    if (decoded.role === 'Hotel') {
      user = await Hotel.findById(decoded.id).select('-password');
    } else if (decoded.role === 'Police') {
      user = await Police.findById(decoded.id).select('-password');
    } else if (decoded.role === 'Regional Admin') {
      user = await RegionalAdmin.findById(decoded.id).select('-password');
    }

    if (!user) {
      return next(new ApiError(401, 'User no longer exists'));
    }

    // Attach user AND role to request
    req.user = user;
    req.user.role = decoded.role; // Explicitly attach role string for easy access

    next();
  } catch (error) {
    res.clearCookie('jwt');
    return next(new ApiError(401, 'Not authorized, token failed'));
  }
});

const authorize = (...roles) => {
  return (req, res, next) => {
    // Check req.user.role (which we attached in protect)
    // OR check the discriminator key if present (e.g., req.user.kind)

    const userRole =
      req.user.role ||
      (req.user.constructor.modelName === 'RegionalAdmin'
        ? 'Regional Admin'
        : req.user.constructor.modelName);

    if (!roles.includes(userRole)) {
      return next(new ApiError(403, `User role '${userRole}' is not authorized for this resource`));
    }
    next();
  };
};

module.exports = { protect, authorize };
