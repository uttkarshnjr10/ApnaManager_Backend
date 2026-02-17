const mongoose = require('mongoose');

const accessLogSchema = new mongoose.Schema({
  // FIX: Dynamic Reference
  user: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'userModel', // Dynamically point to Hotel/Police/Admin
  },
  userModel: {
    type: String,
    required: true,
    enum: ['Hotel', 'Police', 'RegionalAdmin'], // Must match Mongoose model names for refPath
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
});

module.exports = mongoose.model('AccessLog', accessLogSchema);
