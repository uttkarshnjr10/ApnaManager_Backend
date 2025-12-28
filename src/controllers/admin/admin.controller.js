// src/controllers/admin/admin.controller.js
const { User, HotelUser, PoliceUser, RegionalAdminUser } = require('../../models/User.model');
const HotelInquiry = require('../../models/HotelInquiry.model');
const AccessLog = require('../../models/AccessLog.model');
const asyncHandler = require('express-async-handler');
const logger = require('../../utils/logger');
const { sendCredentialsEmail } = require('../../utils/sendEmail');
const crypto = require('crypto');
const ApiError = require('../../utils/ApiError');
const ApiResponse = require('../../utils/ApiResponse');


const registerUser = asyncHandler(async (req, res) => {
    const { username, email, role, details, policeStation } = req.body;
    const userExists = await User.findOne({ email });
    if (userExists) {
        throw new ApiError(400, 'user with this email already exists');
    }
    const temporaryPassword = crypto.randomBytes(8).toString('hex');
    const commonData = {
        username,
        email,
        password: temporaryPassword,
        passwordChangeRequired: true,
    };
    let user;
    if (role === 'Hotel') {
        const hotelData = {
            ...commonData,
            hotelName: details.hotelName,
            ownerName: details.ownerName,
            gstNumber: details.gstNumber,
            phone: details.phone,
            address: details.address,
            city: details.city,
            state: details.state,
            pinCode: details.pinCode,
            nationality: details.nationality,
            postOffice: details.postOffice,
            localThana: details.localThana,
            pinLocation: details.pinLocation,
            ownerSignature: details.ownerSignature,
            hotelStamp: details.hotelStamp,
            aadhaarCard: details.aadhaarCard,
        };
        user = await HotelUser.create(hotelData);
        if (user) {
            try {
                await HotelInquiry.findOneAndUpdate(
                    { email: user.email },
                    { status: 'Approved' },
                    { new: true }
                );
                logger.info(`Associated inquiry for ${user.email} marked as 'Approved'.`);
            } catch (inquiryError) {
                logger.error(`Could not update inquiry for new user ${user.email}: ${inquiryError.message}`);
            }
        }
    } else if (role === 'Police') {
        user = await PoliceUser.create({ ...commonData, ...details, policeStation });
    } else if (role === 'Regional Admin') {
        user = await RegionalAdminUser.create({ ...commonData, ...details });
    } else {
        throw new ApiError(400, 'Invalid user role specified');
    }
    if (user) {
        const tempPassForEmail = temporaryPassword;
        await sendCredentialsEmail(user.email, user.username, tempPassForEmail);
       
        logger.info(`new user (${user.role}) created by admin ${req.user.username}: ${user.email}`);
       
        const responseData = {
            message: 'user created successfully. credentials have been emailed.',
            username: user.username,
            password: tempPassForEmail,
        };
        res.status(201).json(new ApiResponse(201, responseData));
    } else {
        throw new ApiError(400, 'invalid user data');
    }
});

const getAdminDashboardData = asyncHandler(async (req, res) => {
    const hotelCount = await HotelUser.countDocuments();
    const policeCount = await PoliceUser.countDocuments();

    // Placeholder data as per original code
    const guestRegistrationsToday = 0;
    const policeSearchesToday = 0;

    const recentHotels = await HotelUser.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .select('username city hotelName status');

    const recentPolice = await PoliceUser.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .select('username station jurisdiction status');

    const dashboardData = {
        metrics: {
            hotels: hotelCount,
            police: policeCount,
            guestsToday: guestRegistrationsToday,
            searchesToday: policeSearchesToday,
        },
        users: {
            hotels: recentHotels,
            police: recentPolice,
        },
    };

    res.status(200).json(new ApiResponse(200, dashboardData));
});

const getHotelUsers = asyncHandler(async (req, res) => {
    const { searchTerm, status } = req.query;
    const query = {};

    if (status && status !== 'All') {
        query.status = status;
    }

    if (searchTerm) {
        const regex = new RegExp(searchTerm, 'i');
        query.$or = [
            { username: regex },
            { 'city': regex },
            { 'hotelName': regex },
        ];
    }

    const hotels = await HotelUser.find(query).lean();
    res.status(200).json(new ApiResponse(200, hotels));
});

const getPoliceUsers = asyncHandler(async (req, res) => {
    const { searchTerm, status } = req.query;
    const query = {};

    if (status && status !== 'All') {
        query.status = status;
    }

    if (searchTerm) {
        const regex = new RegExp(searchTerm, 'i');
        query.$or = [
            { username: regex },
            { 'station': regex },
            { 'jurisdiction': regex }
        ];
    }

    const policeUsers = await PoliceUser.find(query).lean();
    res.status(200).json(new ApiResponse(200, policeUsers));
});

const updateUserStatus = asyncHandler(async (req, res) => {
    const { status } = req.body;
    const user = await User.findById(req.params.id);

    if (user) {
        user.status = status;
        const updatedUser = await user.save();
        logger.info(`admin ${req.user.username} updated status for user ${user.username} to ${status}`);

        const userObject = updatedUser.toObject();
        delete userObject.password;

        res.status(200).json(new ApiResponse(200, userObject, 'user status updated'));
    } else {
        throw new ApiError(404, 'user not found');
    }
});

const deleteUser = asyncHandler(async (req, res) => {
    const userId = req.params.id;
    const user = await User.findByIdAndDelete(userId);
    if (user) {
        logger.info(`admin ${req.user.username} deleted user ${user.username} (ID: ${userId})`);
       
        if (user.role === 'Hotel' && user.email) {
            try {
                await HotelInquiry.findOneAndUpdate(
                    { email: user.email },
                    { status: 'pending' },
                    { new: true }
                );
            } catch (inquiryError) {
                logger.error(`Could not update inquiry for deleted user ${user.email}: ${inquiryError.message}`);
            }
        }
        res.status(200).json(new ApiResponse(200, null, 'user removed successfully'));
    } else {
        throw new ApiError(404, 'user not found');
    }
});

const getAccessLogs = asyncHandler(async (req, res) => {
    const { searchTerm } = req.query;
    let query = {};

    if (searchTerm) {
        const regex = new RegExp(searchTerm, 'i');
        const users = await User.find({ username: regex }).select('_id');
        const userIds = users.map(user => user._id);

        query.$or = [
            { action: regex },
            { reason: regex },
            { searchQuery: regex },
            { user: { $in: userIds } }
        ];
    }

    const logs = await AccessLog.find(query)
        .populate('user', 'username role')
        .sort({ timestamp: -1 });

    res.status(200).json(new ApiResponse(200, logs));
});

module.exports = { 
    registerUser, 
    getAdminDashboardData,
    getHotelUsers,
    getPoliceUsers,
    updateUserStatus,
    deleteUser,
    getAccessLogs,
};