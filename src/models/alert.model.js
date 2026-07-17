// src/models/alert.model.js — Redesigned as AdminAlert
// Alerts are now system-generated watchlist matches reviewed by Platform Admins.
const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema(
  {
    guest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Guest',
      required: true,
    },
    hotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hotel',
      required: true,
    },
    reason: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['Open', 'Reviewed', 'Resolved'],
      default: 'Open',
    },
    // Who reviews/resolves the alert
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RegionalAdmin',
    },
    reviewNote: {
      type: String,
      trim: true,
    },
    // Identifies the exact person who triggered the alert
    matchedPerson: {
      name: { type: String },
      identifier: { type: String },
      role: { type: String, enum: ['Primary', 'Accompanying'] },
    },
  },
  { timestamps: true }
);

// ── Indexes ─────────────────────────────────────────────────────
alertSchema.index({ hotel: 1, status: 1 });
alertSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Alert', alertSchema);
