// src/controllers/notification.controller.js
const Notification = require('../models/Notification.model');
const asyncHandler = require('express-async-handler');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');

const getMyNotifications = asyncHandler(async (req, res) => {
    // req.user._id comes from the Auth Middleware (which checks all 3 collections)
    // Since ObjectIds are unique across collections, this query is safe.
    const notifications = await Notification.find({ recipientUser: req.user._id })
        .sort({ createdAt: -1 })
        .limit(20)
        // Optional: Populate the sender if you want to show "Sent by Station X"
        // But for now, raw data is fine.
        .lean(); 

    res
        .status(200)
        .json(new ApiResponse(200, notifications));
});

const markAsRead = asyncHandler(async (req, res) => {
    const notification = await Notification.findById(req.params.id);

    if (!notification) {
        throw new ApiError(404, 'notification not found');
    }

    // Security Check: Ensure the user owns this notification
    if (notification.recipientUser.toString() !== req.user._id.toString()) {
        throw new ApiError(403, 'not authorized to modify this notification');
    }

    if (!notification.isRead) {
        notification.isRead = true;
        await notification.save();
    }

    res
        .status(200)
        .json(new ApiResponse(200, notification, 'notification marked as read'));
});

module.exports = { getMyNotifications, markAsRead };