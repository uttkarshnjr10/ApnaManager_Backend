const Hotel = require('../models/Hotel.model');
const Police = require('../models/Police.model');
const RegionalAdmin = require('../models/RegionalAdmin.model');
const HotelInquiry = require('../models/HotelInquiry.model');
const AccessLog = require('../models/AccessLog.model');

const asyncHandler = require('express-async-handler');
const logger = require('../utils/logger');
const { sendCredentialsEmail } = require('../utils/sendEmail');
const crypto = require('crypto');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');

// Helper to check if email exists in ANY collection
const checkEmailExists = async (email) => {
    const [hotel, police, admin] = await Promise.all([
        Hotel.findOne({ email }),
        Police.findOne({ email }),
        RegionalAdmin.findOne({ email })
    ]);
    return hotel || police || admin;
};

// Helper to find a user by ID across collections (mostly for Admin operations)
const findAnyUserById = async (id) => {
    // Check Hotel first (most common), then Police, then Admin
    let user = await Hotel.findById(id);
    if (user) return { user, model: Hotel, role: 'Hotel' };

    user = await Police.findById(id);
    if (user) return { user, model: Police, role: 'Police' };

    user = await RegionalAdmin.findById(id);
    if (user) return { user, model: RegionalAdmin, role: 'Regional Admin' };

    return { user: null, model: null, role: null };
};

const registerUser = asyncHandler(async (req, res) => {
    const { username, email, role, details, policeStation } = req.body;

    // 1. Check Uniqueness across ALL collections
    if (await checkEmailExists(email)) {
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

    // 2. Create in specific collection
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
            // Ensure these match the Object structure in your new Schema
            ownerSignature: details.ownerSignature, 
            hotelStamp: details.hotelStamp,
            aadhaarCard: details.aadhaarCard,
        };
        user = await Hotel.create(hotelData);

        // Update Inquiry Status
        if (user) {
            try {
                await HotelInquiry.findOneAndUpdate(
                    { email: user.email },
                    { status: 'approved' }, // matching lowercase enum in model
                    { new: true }
                );
                logger.info(`Associated inquiry for ${user.email} marked as 'Approved'.`);
            } catch (inquiryError) {
                logger.error(`Could not update inquiry for new user ${user.email}: ${inquiryError.message}`);
            }
        }

    } else if (role === 'Police') {
        user = await Police.create({ ...commonData, ...details, policeStation });
    } else if (role === 'Regional Admin') {
        user = await RegionalAdmin.create({ ...commonData, ...details });
    } else {
        throw new ApiError(400, 'Invalid user role specified');
    }

    if (user) {
        // Send Email
        try {
            await sendCredentialsEmail(user.email, user.username, temporaryPassword);
        } catch (emailErr) {
            logger.error(`Failed to send email to ${user.email}`);
            // We don't rollback user creation, but we log the error
        }
        
        logger.info(`new user (${role}) created by admin ${req.user.username}: ${user.email}`);
        
        const responseData = {
            message: 'user created successfully. credentials have been emailed.',
            username: user.username,
            password: temporaryPassword,
        };
        res.status(201).json(new ApiResponse(201, responseData));
    } else {
        throw new ApiError(400, 'invalid user data');
    }
});

// src/controllers/user.controller.js

const getUserProfile = asyncHandler(async (req, res) => {
    // req.user is the Mongoose document attached by the middleware
    let user = req.user; 
    
    // Convert Mongoose document to a plain JavaScript object
    const userObject = user.toObject ? user.toObject() : { ...user };
    
    // CRITICAL FIX: Manually inject the role into the response
    // The middleware (protect) attached 'role' to req.user, but toObject() strips it out
    // because it's not in the Schema anymore.
    userObject.role = req.user.role; 

    // Remove sensitive data
    delete userObject.password;
    delete userObject.passwordResetToken;
    delete userObject.passwordResetExpires;

    res.status(200).json(new ApiResponse(200, userObject));
});

const updateUserProfile = asyncHandler(async (req, res) => {
    // We know the role from req.user (attached in middleware)
    const role = req.user.role; 
    const userId = req.user._id;

    let Model;
    if (role === 'Hotel') Model = Hotel;
    else if (role === 'Police') Model = Police;
    else if (role === 'Regional Admin') Model = RegionalAdmin;
    else throw new ApiError(400, 'Unknown user role');

    const user = await Model.findById(userId);

    if (!user) {
        throw new ApiError(404, 'user not found');
    }

    user.email = req.body.email || user.email;
    
    if (req.body.details) {
        Object.keys(req.body.details).forEach(key => {
            // Mongoose allows setting properties directly even if nested
            user[key] = req.body.details[key];
        });
    }

    const updatedUser = await user.save();
    
    // Clean response
    const userObject = updatedUser.toObject();
    delete userObject.password;
    delete userObject.passwordResetToken;
    delete userObject.passwordResetExpires;
    
    res.status(200).json(new ApiResponse(200, userObject, 'profile updated successfully'));
});

const updateUserPassword = asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword || newPassword.length < 6) {
        throw new ApiError(400, 'please provide both old and new passwords (min 6 chars for new)');
    }
    
    // Determine Model
    const role = req.user.role;
    let Model;
    if (role === 'Hotel') Model = Hotel;
    else if (role === 'Police') Model = Police;
    else if (role === 'Regional Admin') Model = RegionalAdmin;

    const user = await Model.findById(req.user._id).select('+password');

    if (user && (await user.matchPassword(oldPassword))) {
        user.password = newPassword;
        user.passwordChangeRequired = false;
        await user.save();
        logger.info(`password updated for user: ${user.email}`);

        res.status(200).json(new ApiResponse(200, null, 'password updated successfully'));

    } else {
        throw new ApiError(401, 'invalid old password');
    }
});

const getAdminDashboardData = asyncHandler(async (req, res) => {
    // Count from separate collections
    const hotelCount = await Hotel.countDocuments();
    const policeCount = await Police.countDocuments();

    // Placeholder Logic (You might want to query Guests/Logs here later)
    const guestRegistrationsToday = 0; 
    const policeSearchesToday = 0;

    const recentHotels = await Hotel.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .select('username city hotelName status');

    const recentPolice = await Police.find()
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

    const hotels = await Hotel.find(query).lean();
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

    const policeUsers = await Police.find(query).lean();
    res.status(200).json(new ApiResponse(200, policeUsers));
});

const updateUserStatus = asyncHandler(async (req, res) => {
    const { status } = req.body;
    
    // We don't know if ID belongs to Hotel or Police, so we check using helper
    const { user, model } = await findAnyUserById(req.params.id);

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
    
    // 1. Find the user to know their role (for cleanup logic)
    const { user, model, role } = await findAnyUserById(userId);

    if (user) {
        // 2. Delete using the specific model
        await model.findByIdAndDelete(userId);
        
        logger.info(`admin ${req.user.username} deleted user ${user.username} (ID: ${userId})`);
        
        // Hotel-specific cleanup (Inquiry status)
        if (role === 'Hotel' && user.email) {
            try {
                const updatedInquiry = await HotelInquiry.findOneAndUpdate(
                    { email: user.email },
                    { status: 'pending' },
                    { new: true }
                );
                if (updatedInquiry) {
                    logger.info(`Associated inquiry for ${user.email} marked as 'Pending' (Rejected equivalent).`);
                }
            } catch (inquiryError) {
                logger.error(`Could not update inquiry for deleted user: ${inquiryError.message}`);
            }
        }
        res.status(200).json(new ApiResponse(200, null, 'user removed successfully'));
    } else {
        logger.warn(`Admin ${req.user.username} tried to delete non-existent user ID: ${userId}`);
        throw new ApiError(404, 'user not found');
    }
});

const getAccessLogs = asyncHandler(async (req, res) => {
    const { searchTerm } = req.query;
    let query = {};

    if (searchTerm) {
        const regex = new RegExp(searchTerm, 'i');
        
        // Find matching users in ALL collections
        const [hotels, police, admins] = await Promise.all([
            Hotel.find({ username: regex }).select('_id'),
            Police.find({ username: regex }).select('_id'),
            RegionalAdmin.find({ username: regex }).select('_id')
        ]);

        const userIds = [...hotels, ...police, ...admins].map(u => u._id);

        query.$or = [
            { action: regex },
            { reason: regex },
            { searchQuery: regex },
            { user: { $in: userIds } } // Match any of the found user IDs
        ];
    }

    // Populate works here because AccessLog uses `refPath: 'userModel'`
    // Mongoose will automatically look up the correct collection.
    const logs = await AccessLog.find(query)
        .populate('user', 'username role') 
        .sort({ timestamp: -1 });

    res.status(200).json(new ApiResponse(200, logs));
});

module.exports = { 
    registerUser, 
    getUserProfile,
    updateUserProfile,
    updateUserPassword,
    getAdminDashboardData,
    getHotelUsers,
    getPoliceUsers,
    updateUserStatus,
    deleteUser,
    getAccessLogs,
};