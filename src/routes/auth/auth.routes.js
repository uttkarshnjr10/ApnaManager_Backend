const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { loginUser, changePassword, logoutUser, forgotPassword, resetPassword } = require('../../controllers/auth/auth.controller'); 
const { protect } = require('../../middleware/auth.middleware'); 

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 5, 
    message: 'Too many login attempts, please try again after 15 minutes',
});

router.post('/login', loginLimiter, loginUser);
router.post('/logout', logoutUser);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password/:token', resetPassword);
router.put('/change-password', protect, changePassword);

module.exports = router;