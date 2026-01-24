const Guest = require('../models/Guest.model');
const asyncHandler = require('express-async-handler');
const logger = require('../utils/logger');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');

const getAutocompleteSuggestions = asyncHandler(async (req, res) => {
    const { field, query } = req.query;
    const hotelUserId = req.user._id; // Correct: Comes from Auth Middleware

    if (!field || !query) {
        throw new ApiError(400, 'Field and query parameters are required.');
    }

    let suggestions = [];

    if (field === 'city' && query.length > 1) {
        const distinctCities = await Guest.distinct('primaryGuest.address.city', {
            'primaryGuest.address.city': { $regex: `^${query}`, $options: 'i' }
        });
        suggestions = distinctCities.slice(0, 10);

    } else if (field === 'guestName' && query.length > 2) {
        const guests = await Guest.find({
            'hotel': hotelUserId,
            'primaryGuest.name': { $regex: `^${query}`, $options: 'i' }
        })
        .sort({ registrationTimestamp: -1 }) 
        .limit(5); 

        suggestions = guests.map(guest => guest.primaryGuest);
    }

    res.status(200).json(new ApiResponse(200, suggestions));
});

module.exports = { getAutocompleteSuggestions };