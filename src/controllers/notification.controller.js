// src/controllers/notification.controller.js
const Notification = require('../models/Notification.model');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');

/**
 * Fetch the most recent notifications for the authenticated user.
 * Uses compound index { recipientUser: 1, createdAt: -1 } for optimal performance.
 *
 * @desc    Get current user's notifications
 * @route   GET /api/notifications
 * @access  Private
 */
const getMyNotifications = asyncHandler(async (req, res) => {
  const notifications = await Notification.find({ recipientUser: req.user._id })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  res.status(200).json(new ApiResponse(200, notifications));
});

/**
 * Mark a single notification as read.
 * Uses atomic findOneAndUpdate with ownership filter — single DB call,
 * no race conditions, and no separate authorization check needed.
 *
 * @desc    Mark notification as read
 * @route   PUT /api/notifications/:id/read
 * @access  Private
 */
const markAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipientUser: req.user._id },
    { isRead: true },
    { new: true }
  ).lean();

  if (!notification) {
    throw new ApiError(404, 'Notification not found or not authorized');
  }

  res.status(200).json(new ApiResponse(200, notification, 'Notification marked as read'));
});

module.exports = { getMyNotifications, markAsRead };
