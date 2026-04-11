const mongoose = require('mongoose');

const watchlistSchema = new mongoose.Schema(
  {
    value: {
      type: String,
      required: true,
      trim: true,
      unique: true, // IMPORTANT: 'unique: true' automatically creates a high-performance index in MongoDB!
    },
    type: {
      type: String,
      enum: ['ID_Number', 'Phone_Number'], // Kept your original enums safe
      required: true,
    },
    reason: {
      type: String,
      required: [true, 'A reason for watchlisting is required.'],
      trim: true,
    },
    // This links to the Admin who added the item, for accountability
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'addedByModel',
    },
    addedByModel: {
      type: String,
      required: true,
      enum: ['Police', 'RegionalAdmin'],
    },
  },
  {
    timestamps: true,
  }
);

// ============================================================
// PERFORMANCE OPTIMIZATION: INDEXES
// ============================================================

// Index for finding watchlists by type quickly
watchlistSchema.index({ type: 1 });

// Index for finding who added the watchlist entry quickly
watchlistSchema.index({ addedBy: 1 });

const Watchlist = mongoose.model('Watchlist', watchlistSchema);
module.exports = Watchlist;
