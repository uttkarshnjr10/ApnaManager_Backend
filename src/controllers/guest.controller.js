const mongoose = require('mongoose');
const Guest = require('../models/Guest.model');
const { HotelUser, PoliceUser } = require('../models/User.model');
const asyncHandler = require('express-async-handler');
const logger = require('../utils/logger');
const generateGuestPDF = require('../utils/pdfGenerator');
const { generateGuestReportCSV } = require('../utils/reportGenerator');
const { sendCheckoutEmail } = require('../utils/sendEmail');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const Watchlist = require('../models/Watchlist.model');
const Alert = require('../models/Alert.model');
const Notification = require('../models/Notification.model');
const PoliceStation = require('../models/PoliceStation.model');
const { uploadToCloudinary } = require('../utils/cloudinary');

const checkWatchlistAndNotify = async (guest, hotel) => {
    try {
        const idNumber = guest.idNumber;
        const phone = guest.primaryGuest.phone;

        const match = await Watchlist.findOne({
            $or: [{ value: idNumber }, { value: phone }]
        }).populate('addedBy', 'username');

        if (!match) {
            return;
        }

        logger.warn(`WATCHLIST MATCH: Guest ${guest.primaryGuest.name} (ID: ${idNumber}) matched watchlist item (Reason: ${match.reason})`);

        const alertReason = `AUTOMATIC FLAG: Guest matched watchlist. Reason: "${match.reason}" (Match on: ${match.type})`;
        
        await Alert.create({
            guest: guest._id,
            reason: alertReason,
            createdBy: match.addedBy._id,
            status: 'Open',
        });

        const hotelPincode = hotel.pinCode;
        if (!hotelPincode) {
            logger.error(`Hotel ${hotel.hotelName} has no pincode. Cannot notify police.`);
            return;
        }

        const station = await PoliceStation.findOne({ pincodes: hotelPincode });
        if (!station) {
            logger.warn(`No police station found with jurisdiction over pincode ${hotelPincode}.`);
            return;
        }

        const officers = await PoliceUser.find({ policeStation: station._id });
        if (officers.length === 0) {
            logger.warn(`No officers found for station ${station.name}.`);
            return;
        }

        const notificationMessage = `WATCHLIST MATCH: ${guest.primaryGuest.name} checked into ${hotel.hotelName} (Reason: ${match.reason})`;
        
        const notificationPromises = officers.map(officer => {
            return Notification.create({
                recipientStation: station._id,
                recipientUser: officer._id,
                message: notificationMessage,
                isRead: false,
            });
        });

        await Promise.all(notificationPromises);
        logger.info(`Sent ${officers.length} notifications to ${station.name} about watchlist match.`);

    } catch (error) {
        logger.error(`Failed to execute watchlist check: ${error.message}`);
    }
};

const registerGuest = asyncHandler(async (req, res) => {
    const hotelUserId = req.user._id;
    const hotel = await HotelUser.findById(hotelUserId);
    if (!hotel) {
        throw new ApiError(404, 'hotel user not found');
    }

    const files = req.files || [];
    if (files.length === 0) {
        throw new ApiError(400, 'no files uploaded');
    }

    const uploadResults = await Promise.all(
        files.map(file => uploadToCloudinary(file, 'guest-guard'))
    );

    const filesMap = uploadResults.reduce((map, item) => {
        map[item.fieldname] = item;
        return map;
    }, {});

    const parseMaybeJson = (value, fallback) => {
        if (typeof value === 'string') {
            try { return JSON.parse(value); } catch { return fallback; }
        }
        return value ?? fallback;
    };

    // ✅ NEW OBJECT STRUCTURE (PRIMARY GUEST)
    const idImageFront = {
        url: filesMap['idImageFront']?.url,
        public_id: filesMap['idImageFront']?.public_id
    };
    const idImageBack = {
        url: filesMap['idImageBack']?.url,
        public_id: filesMap['idImageBack']?.public_id
    };
    const livePhoto = {
        url: filesMap['livePhoto']?.url,
        public_id: filesMap['livePhoto']?.public_id
    };

    if (!idImageFront.url || !idImageBack.url || !livePhoto.url) {
        throw new ApiError(400, 'image upload failed. front, back, and live photos are required');
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

    const stayDetailsData = {
        purposeOfVisit: req.body.purposeOfVisit,
        checkIn: req.body.checkIn,
        expectedCheckout: req.body.expectedCheckout,
        roomNumber: req.body.roomNumber,
    };

    if (!stayDetailsData.roomNumber) {
        throw new ApiError(400, 'room number is required');
    }

    const roomToOccupy = hotel.rooms.find(r => r.roomNumber === stayDetailsData.roomNumber);
    if (!roomToOccupy) {
        throw new ApiError(404, `room "${stayDetailsData.roomNumber}" does not exist`);
    }
    if (roomToOccupy.status === 'Occupied') {
        throw new ApiError(400, `room "${stayDetailsData.roomNumber}" is already occupied`);
    }

    const accompanyingGuestsRaw = parseMaybeJson(req.body.accompanyingGuests, []);
    const accompanyingGuests = { adults: [], children: [] };

    (accompanyingGuestsRaw || []).forEach((guest, index) => {
        const processedGuest = {
            ...guest,
            idImageFront: filesMap[`accompanying_${index}_idImageFront`]
                ? {
                    url: filesMap[`accompanying_${index}_idImageFront`].url,
                    public_id: filesMap[`accompanying_${index}_idImageFront`].public_id
                }
                : undefined,
            idImageBack: filesMap[`accompanying_${index}_idImageBack`]
                ? {
                    url: filesMap[`accompanying_${index}_idImageBack`].url,
                    public_id: filesMap[`accompanying_${index}_idImageBack`].public_id
                }
                : undefined,
            livePhoto: filesMap[`accompanying_${index}_livePhoto`]
                ? {
                    url: filesMap[`accompanying_${index}_livePhoto`].url,
                    public_id: filesMap[`accompanying_${index}_livePhoto`].public_id
                }
                : undefined,
        };

        if (!guest.dob) {
            accompanyingGuests.adults.push(processedGuest);
        } else {
            const age = calculateAge(guest.dob);
            age < 14
                ? accompanyingGuests.children.push(processedGuest)
                : accompanyingGuests.adults.push(processedGuest);
        }
    });

    const guest = await Guest.create({
        primaryGuest: primaryGuestData,
        idType: req.body.idType,
        idNumber: req.body.idNumber,
        idImageFront,
        idImageBack,
        livePhoto,
        accompanyingGuests,
        stayDetails: stayDetailsData,
        hotel: hotelUserId,
    });

    roomToOccupy.status = 'Occupied';
    roomToOccupy.guestId = guest._id;
    await hotel.save();

    res.status(201).json(new ApiResponse(201, guest, 'guest registered successfully'));

    checkWatchlistAndNotify(guest, hotel);
});



const calculateAge = (dob) => {
    if (!dob) return 99; 
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < today.getDate())) {
        age--;
    }
    return age;
};

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

            if (guestEmail && hotelEmail) {
                await sendCheckoutEmail(guestEmail, hotelEmail, guest, pdfBuffer);
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