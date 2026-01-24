// src/routes/auth.routes.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { loginUser, changePassword, logoutUser, forgotPassword, resetPassword, forceChangePassword } = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: 'too many login attempts from this ip, please try again after 15 minutes',
    standardHeaders: true,
    legacyHeaders: false,
});

router.post('/login', loginLimiter, loginUser);
//router.post('/change-password', changePassword);
router.post('/logout', protect, logoutUser);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
// NEW ROUTE: Publicly accessible (Protected by logic, not token)
router.post('/change-password', forceChangePassword);

module.exports = router;