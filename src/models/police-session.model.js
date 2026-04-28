// src/models/police-session.model.js
const mongoose = require('mongoose');

const policeSessionSchema = new mongoose.Schema(
  {
    officer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Police',
      required: true,
    },
    photo: {
      url: { type: String, required: true },
      public_id: { type: String, required: true },
    },
    verifiedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    ipAddress: {
      type: String,
      trim: true,
    },
    userAgent: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

// ============================================================
// INDEXES
// ============================================================

// Fast lookup: find active session for a specific officer
policeSessionSchema.index({ officer: 1, expiresAt: 1 });

// TTL Index: MongoDB automatically deletes documents once expiresAt has passed.
// The `expireAfterSeconds: 0` means "delete at the exact expiresAt time".
// This provides free, automatic cleanup — no cron jobs needed.
policeSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const PoliceSession = mongoose.model('PoliceSession', policeSessionSchema);
module.exports = PoliceSession;
