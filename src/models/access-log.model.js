const mongoose = require('mongoose');

const accessLogSchema = new mongoose.Schema({
  // FIX: Dynamic Reference
  user: {
    type: mongoose.Schema.Types.ObjectId,
    required: false,
    refPath: 'userModel', // Dynamically point to Hotel/RegionalAdmin
  },
  userModel: {
    type: String,
    required: true,
    enum: ['Hotel', 'RegionalAdmin'], // Must match Mongoose model names for refPath
  },
  action: {
    type: String,
    required: true,
  },
  reason: {
    type: String,
  },
  searchQuery: {
    type: String, // Only for 'Guest Search' actions
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  entryHash: {
    type: String,
  },
  previousHash: {
    type: String,
  },
});

accessLogSchema.index({ timestamp: -1 });

module.exports = mongoose.model('AccessLog', accessLogSchema);
