const mongoose = require('mongoose');
const Guest = require('../models/Guest.model');
const asyncHandler = require('express-async-handler');
const logger = require('../utils/logger');
const generateGuestPDF = require('../utils/pdfGenerator');
const { generateGuestReportCSV } = require('../utils/reportGenerator');
const { sendCheckoutEmail } = require('../utils/sendEmail');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const { HotelUser } = require('../models/User.model');

// Helper function to calculate age from Date of Birth
const calculateAge = (dob) => {
    if (!dob) return 99; 
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
};

const registerGuest = asyncHandler(async (req, res) => {
    const hotelUserId = req.user._id;
    const filesMap = (req.files || []).reduce((map, file) => {
        map[file.fieldname] = file;
        return map;
    }, {});
    const parseMaybeJson = (value, fallback) => {
        if (typeof value === 'string') {
            try {
                return JSON.parse(value);
            } catch {
                return fallback;
            }
        }
        return value ?? fallback;
    };

    const idImageFrontURL = filesMap['idImageFront']?.path;
    const idImageBackURL = filesMap['idImageBack']?.path;
    const livePhotoURL = filesMap['livePhoto']?.path;
    if (!idImageFrontURL || !idImageBackURL || !livePhotoURL) {
        throw new ApiError(400, 'image upload failed. front, back, and live photos are required');
    }
    const hotel = await HotelUser.findById(hotelUserId);
    if (!hotel) {
        throw new ApiError(404, 'Hotel user not found');
    }
    const stayDetailsData = {
        purposeOfVisit: req.body.purposeOfVisit,
        checkIn: req.body.checkIn,
        expectedCheckout: req.body.expectedCheckout,
        roomNumber: req.body.roomNumber,
    };
    if (!stayDetailsData.roomNumber) {
        throw new ApiError(400, 'Room number is required');
    }
   
    const roomToOccupy = hotel.rooms.find(r => r.roomNumber === stayDetailsData.roomNumber);
    if (!roomToOccupy) {
        throw new ApiError(404, `Room "${stayDetailsData.roomNumber}" does not exist for this hotel.`);
    }
    if (roomToOccupy.status === 'Occupied') {
        throw new ApiError(400, `Room "${stayDetailsData.roomNumber}" is already occupied.`);
    }
    const primaryGuestData = {
        name: req.body.primaryGuestName,
        dob: req.body.primaryGuestDob,
        gender: req.body.primaryGuestGender,
        phone: req.body.primaryGuestPhone,
        email: req.body.primaryGuestEmail,
        address: {
            street: req.body.primaryGuestAddressStreet,
            city: req.body.primaryGuestAddressCity,
            state: req.body.primaryGuestAddressState,
            zipCode: req.body.primaryGuestAddressZipCode,
        },
        nationality: req.body.primaryGuestNationality
    };
    const accompanyingGuestsRaw = parseMaybeJson(req.body.accompanyingGuests, []);
    const accompanyingGuests = {
        adults: [],
        children: [],
    };
    (accompanyingGuestsRaw || []).forEach((guest, index) => {
        
        const processedGuest = {
            ...guest,
            idImageFrontURL: filesMap[`accompanying_${index}_idImageFront`]?.path,
            idImageBackURL: filesMap[`accompanying_${index}_idImageBack`]?.path,
            livePhotoURL: filesMap[`accompanying_${index}_livePhoto`]?.path,
        };
        if (!guest.dob) {
            logger.warn(`Accompanying guest ${guest.name} missing DOB, defaulting to adult.`);
            accompanyingGuests.adults.push(processedGuest);
        } else {
            const age = calculateAge(guest.dob);
            if (age < 14) {
                accompanyingGuests.children.push(processedGuest);
            } else {
                accompanyingGuests.adults.push(processedGuest);
            }
        }
    });
   
    logger.warn('google vision id verification is temporarily bypassed.');
    
    const guest = await Guest.create({
        primaryGuest: primaryGuestData,
        idType: req.body.idType,
        idNumber: req.body.idNumber,
        idImageFrontURL,
        idImageBackURL,
        livePhotoURL,
        accompanyingGuests,
        stayDetails: stayDetailsData,
        hotel: hotelUserId,
    });
    roomToOccupy.status = 'Occupied';
    roomToOccupy.guestId = guest._id;
    await hotel.save();
    logger.info(`new guest registered (${guest.customerId}) in room ${stayDetailsData.roomNumber} at ${req.user.username}`);
    res.status(201).json(new ApiResponse(201, guest, "guest registered successfully!"));
});

const getAllGuests = asyncHandler(async (req, res) => {
    const hotelUserId = req.user._id;

    const guests = await Guest.aggregate([
        { $match: { hotel: new mongoose.Types.ObjectId(hotelUserId) } }, 
        {
            $addFields: {
                totalAccompanyingGuests: {
                    $add: [
                        { $size: "$accompanyingGuests.adults" },
                        { $size: "$accompanyingGuests.children" }
                    ]
                }
            }
        },
        { $sort: { registrationTimestamp: -1 } }
    ]).allowDiskUse(true);

    res.status(200).json(new ApiResponse(200, guests));
});

const getTodaysGuests = asyncHandler(async (req, res) => {
    const hotelUserId = req.user._id;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const guests = await Guest.find({
        hotel: hotelUserId,
        registrationTimestamp: { $gte: startOfToday, $lte: endOfToday }
    })
    .select('primaryGuest.name stayDetails.roomNumber')
    .sort({ registrationTimestamp: -1 })
    .lean();

    res.status(200).json(new ApiResponse(200, guests));
});

const checkoutGuest = asyncHandler(async (req, res) => {
    const guestId = req.params.id;
    
    const guest = await Guest.findById(guestId).populate('hotel', 'username email hotelName city');

    if (!guest) {
        throw new ApiError(404, 'guest not found');
    }

    if (guest.status === 'Checked-Out') {
        throw new ApiError(400, 'this guest has already been checked out');
    }

    guest.status = 'Checked-Out';
    await guest.save();
    try {
        const hotel = await HotelUser.findById(guest.hotel._id);
        if (hotel) {
            const roomNumber = guest.stayDetails.roomNumber;
            const roomToVacate = hotel.rooms.find(r => r.roomNumber === roomNumber);
           
            if (roomToVacate) {
                roomToVacate.status = 'Vacant';
                roomToVacate.guestId = null;
                await hotel.save();
                logger.info(`Room ${roomNumber} is now vacant.`);
            } else {
                logger.warn(`Could not find room ${roomNumber} for hotel ${hotel.username} during checkout.`);
            }
        }
    } catch (roomError) {
        logger.error(`Failed to update room status on checkout: ${roomError.message}`);
    }
    logger.info(`guest ${guest.customerId} checked out by ${req.user.username}`);

    res.status(200).json(new ApiResponse(200, null, 'guest checked out successfully. receipt has been emailed.'));

    setImmediate(async () => {
        try {
            const pdfBuffer = await generateGuestPDF(guest);
            const guestEmail = guest.primaryGuest.email;
            const hotelEmail = guest.hotel.email;
            const hotelName = guest.hotel.hotelName || guest.hotel.username;

            if (guestEmail && hotelEmail) {
                await sendCheckoutEmail(guestEmail, hotelEmail, guest.primaryGuest.name, hotelName, pdfBuffer);
            }
        } catch (error) {
            logger.error(`Failed to send checkout email for guest ${guest.customerId}:`, error);
        }
    });
});


const generateGuestReport = asyncHandler(async (req, res) => {
    const hotelUserId = req.user._id;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
        throw new ApiError(400, 'Both "startDate" and "endDate" query parameters are required.');
    }

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    if (start > end) {
        throw new ApiError(400, 'startDate cannot be after endDate.');
    }

    const guests = await Guest.find({
        hotel: hotelUserId,
        registrationTimestamp: { $gte: start, $lte: end }
    }).sort({ 'stayDetails.checkIn': 1 });

    if (!guests || guests.length === 0) {
        throw new ApiError(404, 'No guest records found for the selected date range.');
    }

    const csvData = generateGuestReportCSV(guests);

    const fileName = `GuestReport_${startDate}_to_${endDate}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    logger.info(`Guest report generated for ${req.user.username} with ${guests.length} records.`);
    
    res.status(200).send(csvData);
});

module.exports = {
    registerGuest,
    getAllGuests,
    getTodaysGuests,
    checkoutGuest,
    generateGuestReport,
};