const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const { User } = require('../models/User.model');
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
        // 1. Check Redis Blacklist
        // We do this BEFORE verify to save CPU cycles on invalid tokens
        const isBlacklisted = await redisClient.get(`blacklist:${token}`);
        
        if (isBlacklisted) {
            res.clearCookie('jwt', cookieOptions);
            return next(new ApiError(401, 'Session expired. Please log in again.'));
        }

        // 2. Verify Token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // 3. Attach User
        req.user = await User.findById(decoded.id).select('-password');
        
        if (!req.user) {
            return next(new ApiError(401, 'User no longer exists'));
        }

        next();

    } catch (error) {
        // Clear cookie if token is invalid/expired
        res.clearCookie('jwt', { ...cookieOptions, maxAge: 0 });

        if (error.name === 'TokenExpiredError') {
            return next(new ApiError(401, 'Token expired, please login again'));
        }
        
        logger.error(`Auth Middleware Error: ${error.message}`);
        return next(new ApiError(401, 'Not authorized, token failed'));
    }
});

const authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return next(new ApiError(403, `User role '${req.user.role}' is not authorized for this resource`));
        }
        next();
    };
};

module.exports = { protect, authorize };