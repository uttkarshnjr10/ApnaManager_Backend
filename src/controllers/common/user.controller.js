// src/controllers/common/user.controller.js
const { User } = require('../../models/User.model');
const asyncHandler = require('express-async-handler');
const logger = require('../../utils/logger'); 
const ApiError = require('../../utils/ApiError'); 
const ApiResponse = require('../../utils/ApiResponse'); 


const getUserProfile = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id).lean();
    if (!user) {
        throw new ApiError(404, 'user not found');
    }

    delete user.password;
    delete user.passwordResetToken;
    delete user.passwordResetExpires;

    res.status(200).json(new ApiResponse(200, user));
});

const updateUserProfile = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) {
        throw new ApiError(404, 'user not found');
    }

    user.email = req.body.email || user.email;
    
    if (req.body.details) {
        Object.keys(req.body.details).forEach(key => {
            user[key] = req.body.details[key];
        });
    }

    const updatedUser = await user.save();
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
    
    const user = await User.findById(req.user.id).select('+password');

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

module.exports = { 
    getUserProfile,
    updateUserProfile,
    updateUserPassword,
};