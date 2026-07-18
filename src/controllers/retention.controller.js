const Guest = require('../models/guest.model');
const asyncHandler = require('express-async-handler');
const ApiResponse = require('../utils/api-response');

/**
 * Get upcoming anonymizations for Regional Admin (Groups by hotel)
 * @route GET /api/admin/retention/upcoming
 * @access Private (RegionalAdmin only)
 */
const getAdminUpcomingAnonymizations = asyncHandler(async (req, res) => {
  const sixtyDaysFromNow = new Date();
  sixtyDaysFromNow.setDate(sixtyDaysFromNow.getDate() + 60);

  const upcomingGuests = await Guest.aggregate([
    {
      $match: {
        isAnonymized: false,
        retentionExpiresAt: { $lte: sixtyDaysFromNow, $gte: new Date() }
      }
    },
    {
      $group: {
        _id: '$hotel',
        count: { $sum: 1 },
        nearestExpiry: { $min: '$retentionExpiresAt' }
      }
    },
    {
      $lookup: {
        from: 'users', // Hotel users collection
        localField: '_id',
        foreignField: '_id',
        as: 'hotelDetails'
      }
    },
    {
      $unwind: '$hotelDetails'
    },
    {
      $project: {
        hotelId: '$_id',
        hotelName: '$hotelDetails.hotelName',
        count: 1,
        nearestExpiry: 1,
        _id: 0
      }
    },
    { $sort: { nearestExpiry: 1 } }
  ]);

  res.status(200).json(new ApiResponse(200, upcomingGuests, 'Upcoming anonymizations retrieved'));
});

/**
 * Get upcoming anonymizations for a specific Hotel
 * @route GET /api/hotel/retention/upcoming
 * @access Private (Hotel only)
 */
const getHotelUpcomingAnonymizations = asyncHandler(async (req, res) => {
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const upcomingCount = await Guest.countDocuments({
    hotel: req.user._id,
    isAnonymized: false,
    retentionExpiresAt: { $lte: thirtyDaysFromNow, $gte: new Date() }
  });

  res.status(200).json(new ApiResponse(200, { count: upcomingCount }, 'Upcoming hotel anonymizations retrieved'));
});

module.exports = {
  getAdminUpcomingAnonymizations,
  getHotelUpcomingAnonymizations
};
