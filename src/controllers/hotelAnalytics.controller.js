const mongoose = require('mongoose');
const Guest = require('../models/guest.model');
const asyncHandler = require('express-async-handler');
const ApiResponse = require('../utils/api-response');

/**
 * Get analytics for a specific hotel within a date range
 * @desc Runs multiple aggregations to return business analytics
 * @route GET /api/hotel/analytics
 * @access Private (Hotel staff only)
 */
const getHotelAnalytics = asyncHandler(async (req, res) => {
  const hotelUserId = new mongoose.Types.ObjectId(req.user._id);
  
  // Default to current month if no dates provided
  let { startDate, endDate } = req.query;
  const today = new Date();
  
  let start, end;
  if (startDate && endDate) {
    start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    
    end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
  } else {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
    end = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  const rangeFilter = {
    hotel: hotelUserId,
    registrationTimestamp: { $gte: start, $lte: end }
  };

  const daysDifference = (end - start) / (1000 * 60 * 60 * 24);

  // Run aggregations in parallel
  const [
    totalGuestsRes,
    statusBreakdownRes,
    nationalityRes,
    purposeRes,
    avgStayRes,
    dayOfWeekRes,
    monthlyTrendRes,
    roomUtilizationRes,
    cFormRes
  ] = await Promise.all([
    
    // 1. Total Guests
    Guest.countDocuments(rangeFilter),

    // 2. Guests by Status
    Guest.aggregate([
      { $match: rangeFilter },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),

    // 3. Nationality Breakdown (Indian vs Foreign + Top 10)
    Guest.aggregate([
      { $match: rangeFilter },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: [{ $toLower: { $trim: { input: '$primaryGuest.nationality' } } }, 'indian'] },
              'Indian',
              'Foreign'
            ]
          },
          count: { $sum: 1 },
          nationalities: { $push: { $trim: { input: '$primaryGuest.nationality' } } }
        }
      }
    ]),

    // 4. Purpose of Visit Breakdown
    Guest.aggregate([
      { $match: rangeFilter },
      { $group: { _id: '$stayDetails.purposeOfVisit', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]),

    // 5. Average Length of Stay (Completed stays only)
    Guest.aggregate([
      { $match: { ...rangeFilter, status: 'Checked-Out', 'stayDetails.checkOut': { $exists: true } } },
      {
        $group: {
          _id: null,
          avgStayMs: {
            $avg: { $subtract: ['$stayDetails.checkOut', '$stayDetails.checkIn'] }
          }
        }
      }
    ]),

    // 6. Guests by Day of Week
    Guest.aggregate([
      { $match: rangeFilter },
      {
        $group: {
          _id: { $dayOfWeek: '$registrationTimestamp' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]),

    // 7. Guests by Month (Trend line, only if > 30 days)
    daysDifference > 30 ? Guest.aggregate([
      { $match: rangeFilter },
      {
        $group: {
          _id: {
            year: { $year: '$registrationTimestamp' },
            month: { $month: '$registrationTimestamp' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]) : Promise.resolve([]),

    // 8. Room Utilization (Top rooms among checked-out guests)
    Guest.aggregate([
      { $match: { ...rangeFilter, status: 'Checked-Out' } },
      { $group: { _id: '$stayDetails.roomNumber', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]),

    // 9. C-Form Compliance
    Guest.aggregate([
      { $match: { ...rangeFilter, 'cForm.status': { $ne: 'not_required' } } },
      {
        $group: {
          _id: '$cForm.status',
          count: { $sum: 1 }
        }
      }
    ])
  ]);

  // --- Format Responses ---
  const checkedIn = statusBreakdownRes.find(s => s._id === 'Checked-In')?.count || 0;
  const checkedOut = statusBreakdownRes.find(s => s._id === 'Checked-Out')?.count || 0;

  // Formatting Nationality
  let indianCount = 0;
  let foreignCount = 0;
  let rawNationalities = [];

  nationalityRes.forEach(group => {
    if (group._id === 'Indian') {
      indianCount = group.count;
    } else {
      foreignCount = group.count;
    }
    rawNationalities = rawNationalities.concat(group.nationalities);
  });

  const natCountMap = rawNationalities.reduce((acc, nat) => {
    const key = nat ? (nat.charAt(0).toUpperCase() + nat.slice(1).toLowerCase()) : 'Unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const detailedBreakdown = Object.entries(natCountMap)
    .map(([nationality, count]) => ({ nationality, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Formatting Purpose of Visit
  const purposeBreakdown = purposeRes.map(p => ({
    purpose: p._id || 'Not Specified',
    count: p.count,
    percentage: ((p.count / totalGuestsRes) * 100).toFixed(1)
  }));

  // Average Stay
  let averageStayDays = 0;
  if (avgStayRes.length > 0 && avgStayRes[0].avgStayMs) {
    averageStayDays = (avgStayRes[0].avgStayMs / (1000 * 60 * 60 * 24)).toFixed(1);
  }

  // Day of Week
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const guestsByDayOfWeekMap = {};
  dayOfWeekRes.forEach(d => {
    guestsByDayOfWeekMap[d._id] = d.count;
  });
  const guestsByDayOfWeek = [1, 2, 3, 4, 5, 6, 7].map(dayNum => ({
    day: daysOfWeek[dayNum - 1], // dayOfWeek in mongo: 1 (Sun) to 7 (Sat)
    count: guestsByDayOfWeekMap[dayNum] || 0
  }));

  // Guests by Month
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const guestsByMonth = monthlyTrendRes.map(m => ({
    month: `${months[m._id.month - 1]} ${m._id.year}`,
    count: m.count
  }));

  // Top Rooms
  const topRooms = roomUtilizationRes.map(r => ({
    roomNumber: r._id || 'Unknown',
    count: r.count
  }));

  // C-Form Compliance
  let cFormRequired = 0;
  let cFormSubmitted = 0;
  let cFormPending = 0;
  cFormRes.forEach(c => {
    cFormRequired += c.count;
    if (c._id === 'submitted') cFormSubmitted += c.count;
    if (c._id === 'pending' || c._id === 'generated') cFormPending += c.count;
  });

  const responseData = {
    dateRange: { startDate: start, endDate: end },
    summary: {
      totalGuests: totalGuestsRes,
      checkedIn,
      checkedOut,
      averageStayDays,
      foreignGuests: foreignCount,
      indianGuests: indianCount
    },
    purposeBreakdown,
    nationalityBreakdown: {
      indian: indianCount,
      foreign: foreignCount,
      breakdown: detailedBreakdown
    },
    guestsByDayOfWeek,
    guestsByMonth,
    topRooms,
    cformCompliance: {
      required: cFormRequired,
      submitted: cFormSubmitted,
      pending: cFormPending
    }
  };

  res.status(200).json(new ApiResponse(200, responseData, 'Analytics retrieved successfully'));
});

module.exports = {
  getHotelAnalytics
};
