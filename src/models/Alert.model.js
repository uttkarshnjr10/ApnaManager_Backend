const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema(
  {
    guest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Guest',
      required: true,
    },
    reason: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['Open', 'Resolved'],
      default: 'Open',
    },
    // FIX: Dynamic Creator
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'creatorModel',
    },
    creatorModel: {
      type: String,
      required: true,
      enum: ['Police', 'Regional Admin', 'System'], // Added 'System' for auto-watchlists
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Alert', alertSchema);
