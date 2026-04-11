// src/models/Notification.model.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipientStation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PoliceStation',
      // Not required if the notification is for a Regional Admin who has no station
      required: false,
    },

    // DYNAMIC REFERENCE
    recipientUser: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'recipientModel', // Tells Mongoose which collection to join
    },
    recipientModel: {
      type: String,
      required: true,
      enum: ['Police', 'RegionalAdmin', 'Hotel'],
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
// Sorts by createdAt desc, so compound index is needed
notificationSchema.index({ recipientUser: 1, createdAt: -1 });

// Index for filtering unread notifications
notificationSchema.index({ recipientUser: 1, isRead: 1 });

// Index for station-wide notifications
notificationSchema.index({ recipientStation: 1, createdAt: -1 });

// Index for filtering unread by station
notificationSchema.index({ recipientStation: 1, isRead: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
