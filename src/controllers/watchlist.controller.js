const Watchlist = require('../models/Watchlist.model');
const asyncHandler = require('express-async-handler');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const logger = require('../utils/logger');

const getWatchlistItems = asyncHandler(async (req, res) => {
    // Mongoose automatically uses 'addedByModel' to know which collection to populate from
    const items = await Watchlist.find({})
        .populate('addedBy', 'username') 
        .sort({ createdAt: -1 });
    
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

    // Determine the Model based on the logged-in user's role
    // req.user.role comes from your auth middleware
    let modelName;
    if (req.user.role === 'Regional Admin') modelName = 'RegionalAdmin';
    else if (req.user.role === 'Police') modelName = 'Police';
    else modelName = 'RegionalAdmin'; // Fallback or throw error if Hotels shouldn't add

    const newItem = await Watchlist.create({
        value: value.trim(),
        type,
        reason,
        addedBy: req.user._id,
        addedByModel: modelName // <--- CRITICAL FIX: Dynamic Reference
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

module.exports = {
    getWatchlistItems,
    addWatchlistItem,
    deleteWatchlistItem,
};