
const logger = require('../utils/logger');
const ApiError = require('../utils/ApiError');

// handle 404 Routes
const notFound = (req, res, next) => {
    const error = new ApiError(404, `Not Found - ${req.originalUrl}`);
    next(error);
};

// global Error Handler
const errorHandler = (err, req, res, next) => {
    let error = { ...err };
    error.message = err.message;
    error.statusCode = err.statusCode || 500;

    // Log the original error 
    // log the stack trace to see exactly where it broke
    logger.error(`${err.statusCode || 500} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`);
    if (process.env.NODE_ENV !== 'production') {
        logger.error(err.stack);
    }

    // Mongoose Bad ObjectId 
    // occurs when looking up an ID that doesn't exist or is malformed
    if (err.name === 'CastError') {
        const message = `Resource not found. Invalid: ${err.path}`;
        error = new ApiError(404, message);
    }

    // Mongoose Duplicate Key 
    // when registering an email/username that already exists
    if (err.code === 11000) {
        // extract the field name that caused the duplicate error
        const value = Object.keys(err.keyValue)[0]; 
        const message = `Duplicate field value entered: ${value}. Please use another value.`;
        error = new ApiError(400, message);
    }

    // mongoose validation error 
    if (err.name === 'ValidationError') {
        const messages = Object.values(err.errors).map((val) => val.message);
        const message = `Validation Error: ${messages.join(', ')}`;
        error = new ApiError(400, message);
    }

    // JWT errors 
    if (err.name === 'JsonWebTokenError') {
        const message = 'Invalid token. Please log in again.';
        error = new ApiError(401, message);
    }

    if (err.name === 'TokenExpiredError') {
        const message = 'Your session has expired. Please log in again.';
        error = new ApiError(401, message);
    }

   // send Final Response
    const statusCode = error.statusCode || 500;
    
    res.status(statusCode).json({
        success: false,
        message: error.message || 'Server Error',
        // Hide stack if it's Production OR if it's just a 401/403 (expected auth error)
        stack: process.env.NODE_ENV === 'production' || statusCode === 401 || statusCode === 403 
            ? null 
            : err.stack,
    });
};

module.exports = { notFound, errorHandler };