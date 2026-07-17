// src/models/Notification.model.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    // DYNAMIC REFERENCE
    recipientUser: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'recipientModel',
    },
    recipientModel: {
      type: String,
      required: true,
      enum: ['RegionalAdmin', 'Hotel'],
    },

    message: {
      type: String,
      required: true,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// ============================================================
// PERFORMANCE OPTIMIZATION: INDEXES
// ============================================================

// CRITICAL: Index for getMyNotifications query
notificationSchema.index({ recipientUser: 1, createdAt: -1 });

// Index for filtering unread notifications
notificationSchema.index({ recipientUser: 1, isRead: 1 });

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
