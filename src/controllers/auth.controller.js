// src/controllers/auth.controller.js
const Hotel = require('../models/Hotel.model');
const Police = require('../models/Police.model');
const RegionalAdmin = require('../models/RegionalAdmin.model');

const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const logger = require('../utils/logger');
const { client: redisClient } = require('../config/redisClient');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const crypto = require('crypto');
const { sendPasswordResetEmail } = require('../utils/sendEmail');

// Helper to find user in ANY collection
const findUserByEmail = async (email, loginType) => {
    
    // 1. FAST PATH: The user told us who they are
    if (loginType === 'Hotel') {
        const user = await Hotel.findOne({ email }).select('+password');
        return user ? { user, role: 'Hotel' } : { user: null, role: null };
    }
    
    if (loginType === 'Police') {
        const user = await Police.findOne({ email }).select('+password');
        return user ? { user, role: 'Police' } : { user: null, role: null };
    }
    
    if (loginType === 'Regional Admin' || loginType === 'RegionalAdmin') {
        const user = await RegionalAdmin.findOne({ email }).select('+password');
        return user ? { user, role: 'Regional Admin' } : { user: null, role: null };
    }

    // 2. FALLBACK (Compatibility): If loginType is missing or invalid, search everything
    // This makes it robust against Postman/API misuse
    const [hotel, police, admin] = await Promise.all([
        Hotel.findOne({ email }).select('+password'),
        Police.findOne({ email }).select('+password'),
        RegionalAdmin.findOne({ email }).select('+password')
    ]);

    if (hotel) return { user: hotel, role: 'Hotel' };
    if (police) return { user: police, role: 'Police' };
    if (admin) return { user: admin, role: 'Regional Admin' };
    
    return { user: null, role: null };
};

const generateToken = (id, role, username) => {
    return jwt.sign({ id, role, username }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
};

// Login User
const loginUser = asyncHandler(async (req, res) => {
    // 1. Extract & Validate
    const { email, password, loginType } = req.body;

    if (!email || !password) {
        throw new ApiError(400, 'Email and password are required');
    }

    // 2. Find User
    const { user, role } = await findUserByEmail(email, loginType);

    // 3. Security Check: Invalid Credentials
    if (!user || !(await user.matchPassword(password))) {
        throw new ApiError(401, 'Invalid email or password');
    }

    // 4. Security Check: Account Status
    if (user.status === 'Suspended') {
        throw new ApiError(403, 'Your account has been suspended');
    }

    // 5. Check Password Reset Requirement
    if (user.passwordChangeRequired) {
        return res
            .status(202)
            .json(new ApiResponse(202, { userId: user._id, role }, 'Password change required'));
    }

    // 6. Generate Token
    const token = generateToken(user._id, role, user.username);
    
    logger.info(`${role} logged in: ${user.email} (Type: ${loginType || 'Auto'})`);

    // 7. Set Secure Cookie (Primary Security Layer)
    // We keep this! It allows valid cross-site requests if the browser permits it.
    res.cookie('jwt', token, cookieOptions);

    // 8. Prepare Response (Secondary Persistence Layer)
    // We send the token here so the Frontend can save it to localStorage.
    // This FIXES the "Logout on Refresh" issue on Vercel/Render setups.
    const userData = {
        _id: user._id,
        username: user.username,
        role: role,
        token: token, 
    };

    res.status(200).json(new ApiResponse(200, userData, 'Login successful'));
});

// ================= LOGOUT =================
const logoutUser = asyncHandler(async (req, res) => {
    // (Logic remains same as your previous optimized version)
    const token = req.cookies?.jwt || (req.headers.authorization?.startsWith('Bearer') ? req.headers.authorization.split(' ')[1] : null);

    if (token) {
        try {
            const decoded = jwt.decode(token);
            if (decoded?.exp) {
                const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
                if (expiresIn > 0) {
                    await redisClient.set(`blacklist:${token}`, 'true', { EX: expiresIn });
                }
            }
        } catch (error) {
            logger.error(`Logout blacklist warning: ${error.message}`);
        }
    }
    
    res.cookie('jwt', '', { ...cookieOptions, maxAge: 0, expires: new Date(0) });
    res.status(200).json(new ApiResponse(200, null, 'logged out successfully'));
});

// ================= FORGOT PASSWORD =================
const forgotPassword = asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!email) throw new ApiError(400, 'please provide an email address');

    const { user } = await findUserByEmail(email);
    
    if (!user) {
        // Security: Don't reveal user doesn't exist
        return res.status(200).json(new ApiResponse(200, null, 'if an account exists, a reset link has been sent'));
    }

    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });

    // ... (Email sending logic remains same) ...
    const frontendUrl = process.env.CORS_ALLOWED_ORIGINS?.split(',')[0] || 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    try {
        await sendPasswordResetEmail(user.email, user.username, resetUrl);
        res.status(200).json(new ApiResponse(200, null, 'if an account exists, a reset link has been sent'));
    } catch (err) {
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        await user.save({ validateBeforeSave: false });
        throw new ApiError(500, 'failed to send password reset email');
    }
});

// ================= RESET PASSWORD =================
const resetPassword = asyncHandler(async (req, res) => {
    const { token, newPassword } = req.body;
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    // We must check ALL collections for the token
    const [hotel, police, admin] = await Promise.all([
        Hotel.findOne({ passwordResetToken: hashedToken, passwordResetExpires: { $gt: Date.now() } }),
        Police.findOne({ passwordResetToken: hashedToken, passwordResetExpires: { $gt: Date.now() } }),
        RegionalAdmin.findOne({ passwordResetToken: hashedToken, passwordResetExpires: { $gt: Date.now() } })
    ]);

    const user = hotel || police || admin;

    if (!user) {
        throw new ApiError(400, 'token is invalid or expired');
    }

    user.password = newPassword;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.passwordChangeRequired = false;
    await user.save();

    res.status(200).json(new ApiResponse(200, null, 'password reset successfully'));
});

// ================= CHANGE PASSWORD (Authenticated) =================
const changePassword = asyncHandler(async (req, res) => {
    const { userId, newPassword } = req.body; // Warning: Using req.body.userId is risky, use req.user._id if logged in
    
    // Better implementation: Use the user from the token (req.user)
    // But keeping your signature:
    
    // We need to know WHICH collection to look in. 
    // Ideally, this route is protected, so `req.user` is already populated by middleware.
    
    const user = req.user; // Use the attached user from middleware
    if (!user) throw new ApiError(401, 'User not authenticated');

    user.password = newPassword;
    user.passwordChangeRequired = false;
    await user.save();

    res.status(200).json(new ApiResponse(200, null, 'password changed successfully'));
});

const forceChangePassword = asyncHandler(async (req, res) => {
    console.log("request arrive ");
    const { userId, newPassword } = req.body;

    if (!userId || !newPassword) {
        throw new ApiError(400, 'User ID and new password are required');
    }

    console.log("userId" , userId);

    if (newPassword.length < 6) {
        throw new ApiError(400, 'Password must be at least 6 characters');
    }

    // 1. Find User in any collection
    let user = await Hotel.findById(userId).select('+password');
    if (!user) user = await Police.findById(userId).select('+password');
    if (!user) user = await RegionalAdmin.findById(userId).select('+password');

    if (!user) {
        throw new ApiError(404, 'User not found');
    }

    // 2. SECURITY CHECK (The most important part)
    // Only allow this if the DB flag is explicitly TRUE.
    // This prevents hackers from using this public route to reset random users.
    if (!user.passwordChangeRequired) {
        throw new ApiError(403, 'Password change is not required. Please login normally.');
    }

    // 3. Update Password
    user.password = newPassword;
    user.passwordChangeRequired = false; // Close the security gate
    await user.save();

    logger.info(`Force password change successful for user: ${user.email}`);
    res.status(200).json(new ApiResponse(200, null, 'Password updated successfully. Please login.'));
});

module.exports = {
    loginUser,
    changePassword,
    logoutUser,
    forgotPassword,
    resetPassword,
    forceChangePassword,
};