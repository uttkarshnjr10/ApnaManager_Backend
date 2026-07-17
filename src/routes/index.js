const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const guestRoutes = require('./guest.routes');
const inquiryRoutes = require('./inquiry.routes');
const notificationRoutes = require('./notification.routes');
const uploadRoutes = require('./upload.routes');
const userRoutes = require('./user.routes');
const paymentRoutes = require('./payment.routes.js');
const roomRoutes = require('./room.routes.js');
const watchlistRoutes = require('./watchlist.routes.js');
const weatherRoutes = require('./weather.routes');
const hotelAnalyticsRoutes = require('./hotelAnalytics.routes');
const complianceRoutes = require('./compliance.routes');
const retentionRoutes = require('./retention.routes');

router.use('/auth', authRoutes);
router.use('/guests', guestRoutes);
router.use('/inquiries', inquiryRoutes);
router.use('/notifications', notificationRoutes);
router.use('/upload', uploadRoutes);
router.use('/users', userRoutes);
router.use('/payments', paymentRoutes);
router.use('/rooms', roomRoutes);
router.use('/watchlist', watchlistRoutes);
router.use('/weather', weatherRoutes);
router.use('/hotel', hotelAnalyticsRoutes);
router.use('/admin/compliance', complianceRoutes);
router.use('/', retentionRoutes);

module.exports = router;
