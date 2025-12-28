// src/routes/index.js
const express = require('express');
const router = express.Router();

// --- Import Routes ---
const authRoutes = require('./auth/auth.routes');
const adminRoutes = require('./admin/admin.routes');
const stationRoutes = require('./admin/station.routes');
const watchlistRoutes = require('./admin/watchlist.routes');
const guestRoutes = require('./hotel/guest.routes');
const roomRoutes = require('./hotel/room.routes');
const inquiryRoutes = require('./hotel/inquiry.routes');
const paymentRoutes = require('./hotel/payment.routes');
const ocrRoutes = require('./hotel/ocr.routes');
const autocompleteRoutes = require('./hotel/autocomplete.routes');
const policeRoutes = require('./police/police.routes');
const notificationRoutes = require('./police/notification.routes');
const userRoutes = require('./common/user.routes');
const uploadRoutes = require('./common/upload.routes');

// --- Mount Routes ---

// Auth
router.use('/auth', authRoutes);

// Admin Dashboard & Admin-specific User Routes
// Maps to: /api/users/admin/dashboard, /api/users/admin/hotels
router.use('/users/admin', adminRoutes); 

// General User Routes (Profile + Legacy Admin Actions)
// Maps to: /api/users/profile, /api/users/police, /api/users/register
router.use('/users', userRoutes);

// Police Stations (Fixed URL: /api/stations)
router.use('/stations', stationRoutes); 

// Watchlist (Fixed URL: /api/watchlist)
router.use('/watchlist', watchlistRoutes);

// Hotel Operations
router.use('/guests', guestRoutes);
router.use('/rooms', roomRoutes);
router.use('/inquiries', inquiryRoutes);
router.use('/payment', paymentRoutes);
router.use('/ocr', ocrRoutes);
router.use('/autocomplete', autocompleteRoutes);

// Police Operations
router.use('/police', policeRoutes);
router.use('/notifications', notificationRoutes);

// Common
router.use('/upload', uploadRoutes);

module.exports = router;