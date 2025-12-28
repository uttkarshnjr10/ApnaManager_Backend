const Notification = require('../../models/Notification.model'); // Added ../
const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/ApiError');       
const ApiResponse = require('../../utils/ApiResponse'); 

const getMyNotifications = asyncHandler(async (req, res) => {
    // Fetches the 20 most recent notifications for the currently logged-in user
    const notifications = await Notification.find({ recipientUser: req.user._id })
        .sort({ createdAt: -1 })
        .limit(20);

    res
        .status(200)
        .json(new ApiResponse(200, notifications));
});

const markAsRead = asyncHandler(async (req, res) => {
    const notification = await Notification.findById(req.params.id);

    // Ensure the notification exists and belongs to the user making the request
    if (!notification || notification.recipientUser.toString() !== req.user._id.toString()) {
        throw new ApiError(404, 'notification not found or user not authorized');
    }

    // To save a database write, only update if it's currently unread
    if (!notification.isRead) {
        notification.isRead = true;
        await notification.save();
    }

    res
         .status(200)
         .json(new ApiResponse(200, notification, 'notification marked as read'));
});

module.exports = { getMyNotifications, markAsRead };
