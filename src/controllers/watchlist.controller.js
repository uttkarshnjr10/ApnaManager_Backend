const Watchlist = require('../models/watchlist.model');
const Alert = require('../models/alert.model');
const AccessLog = require('../models/access-log.model');
const asyncHandler = require('express-async-handler');
const ApiError = require('../utils/api-error');
const ApiResponse = require('../utils/api-response');
const logger = require('../utils/logger');

const getWatchlistItems = asyncHandler(async (req, res) => {
  // Mongoose automatically uses 'addedByModel' to know which collection to populate from
  const items = await Watchlist.find({}).populate('addedBy', 'username').sort({ createdAt: -1 });

  res.status(200).json(new ApiResponse(200, items));
});

const addWatchlistItem = asyncHandler(async (req, res) => {
  const { value, type, reason } = req.body;

  if (!value || !type || !reason) {
    throw new ApiError(400, 'Value, type, and reason are all required');
  }

  const itemExists = await Watchlist.findOne({ value: value.trim() });
  if (itemExists) {
    throw new ApiError(400, 'This ID or Phone Number is already on the watchlist');
  }

  // Only Platform Admins (Regional Admin) can add to watchlist
  const modelName = 'RegionalAdmin';

  const newItem = await Watchlist.create({
    value: value.trim(),
    type,
    reason,
    addedBy: req.user._id,
    addedByModel: modelName, // <--- CRITICAL FIX: Dynamic Reference
  });

  // Populate immediately to return the full object
  const populatedItem = await newItem.populate('addedBy', 'username');

  logger.info(`User ${req.user.username} (${req.user.role}) added item to watchlist`);
  res.status(201).json(new ApiResponse(201, populatedItem, 'Item added to watchlist'));
});

const deleteWatchlistItem = asyncHandler(async (req, res) => {
  const item = await Watchlist.findByIdAndDelete(req.params.id);

  if (!item) {
    throw new ApiError(404, 'Watchlist item not found');
  }

  logger.info(`User ${req.user.username} removed item ${item.value} from the watchlist`);
  res.status(200).json(new ApiResponse(200, null, 'Item removed from watchlist'));
});

const getWatchlistAlerts = asyncHandler(async (req, res) => {
  const alerts = await Alert.find({ status: 'Open' })
    .populate('guest', 'primaryGuest.name stayDetails.roomNumber')
    .sort({ createdAt: -1 });

  res.status(200).json(new ApiResponse(200, alerts, 'Watchlist alerts retrieved successfully'));
});

const dismissAlert = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;

  const alert = await Alert.findByIdAndUpdate(
    id,
    { status: 'Resolved', reviewNote: notes, reviewedBy: req.user._id },
    { new: true }
  );

  if (!alert) throw new ApiError(404, 'Alert not found');

  await AccessLog.create({
    action: 'WATCHLIST_ALERT_DISMISSED',
    reason: `Alert ${id} dismissed by ${req.user.username}. Notes: ${notes || 'None'}`,
  });

  res.status(200).json(new ApiResponse(200, alert, 'Alert dismissed successfully'));
});

const actionAlert = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;

  if (!notes) {
    throw new ApiError(400, 'Action notes are required');
  }

  const alert = await Alert.findByIdAndUpdate(
    id,
    { status: 'Reviewed', reviewNote: notes, reviewedBy: req.user._id },
    { new: true }
  );

  if (!alert) throw new ApiError(404, 'Alert not found');

  await AccessLog.create({
    action: 'WATCHLIST_ALERT_ACTIONED',
    reason: `Alert ${id} actioned by ${req.user.username}. Notes: ${notes}`,
  });

  res.status(200).json(new ApiResponse(200, alert, 'Alert actioned successfully'));
});

module.exports = {
  getWatchlistItems,
  addWatchlistItem,
  deleteWatchlistItem,
  getWatchlistAlerts,
  dismissAlert,
  actionAlert,
};
