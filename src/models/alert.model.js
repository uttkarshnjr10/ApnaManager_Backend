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
      enum: ['Police', 'RegionalAdmin', 'System'], // Must match Mongoose model names for refPath
    },
    // Optional: Identifies the exact person who triggered the alert
    // (useful when the match is an accompanying guest, not the primary)
    matchedPerson: {
      name: { type: String },
      identifier: { type: String }, // The ID number or phone that matched
      role: { type: String, enum: ['Primary', 'Accompanying'] },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Alert', alertSchema);
