const cron = require('node-cron');
const { runDataRetentionJob } = require('./dataRetentionJob');
const logger = require('./logger');
const Guest = require('../models/guest.model');
const Notification = require('../models/notification.model');
const { getIO } = require('../config/socket');

function startScheduledJobs() {
  // Job 1: Run every night at 2:00 AM for automated retention processing
  cron.schedule('0 2 * * *', async () => {
    logger.info('Starting scheduled data retention job');
    try {
      await runDataRetentionJob();
    } catch (error) {
      logger.error(`Data retention job failed: ${error.message}`);
    }
  });

  // Job 2: Run on the 1st of every month at 9:00 AM for upcoming anonymization notifications
  cron.schedule('0 9 1 * *', async () => {
    logger.info('Starting upcoming anonymizations notification job');
    try {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      // Find guests expiring in the next 30 days
      const upcomingGuests = await Guest.find({
        isAnonymized: false,
        retentionExpiresAt: { $lte: thirtyDaysFromNow, $gte: new Date() }
      });

      // Group by hotel
      const hotelCounts = upcomingGuests.reduce((acc, guest) => {
        const hotelId = guest.hotel.toString();
        acc[hotelId] = (acc[hotelId] || 0) + 1;
        return acc;
      }, {});

      for (const [hotelId, count] of Object.entries(hotelCounts)) {
        const message = `${count} guest records will be anonymized in the next 30 days as per our 3-year data retention policy. This is automatic and no action is required.`;
        
        await Notification.create({
          recipientUser: hotelId,
          message
        });

        const io = getIO();
        io.to(hotelId).emit('NOTIFICATION', { message });
      }

      logger.info(`Upcoming anonymizations notification job complete. Notified ${Object.keys(hotelCounts).length} hotels.`);
    } catch (error) {
      logger.error(`Upcoming anonymizations notification job failed: ${error.message}`);
    }
  });

  // Job 3: Run daily at 3:00 AM for hotel badge eligibility check
  cron.schedule('0 3 * * *', async () => {
    logger.info('Starting hotel badge eligibility check');
    try {
      const Hotel = require('../models/hotel.model');
      
      const activeHotels = await Hotel.find({
        role: 'Hotel', // ensure only hotels
        status: 'Active',
        badgeEligible: false
      });

      const now = Date.now();

      for (const hotel of activeHotels) {
        const daysSinceCreated = Math.floor((now - hotel.createdAt.getTime()) / 86400000);
        
        if (daysSinceCreated >= 30) {
          const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
          
          const guestCount = await Guest.countDocuments({
            hotel: hotel._id,
            registrationTimestamp: { $gte: thirtyDaysAgo }
          });

          if (guestCount >= 10) {
            const verificationCode = 'AM' + hotel._id.toString().slice(-6).toUpperCase() + Math.random().toString(36).substr(2, 4).toUpperCase();
            
            hotel.verificationCode = verificationCode;
            hotel.verifiedAt = new Date();
            hotel.badgeEligible = true;
            
            await hotel.save();

            const message = "Congratulations! Your hotel is now eligible for the Apna Manager Compliance Badge. Download it from Settings.";
            
            await Notification.create({
              recipientUser: hotel._id,
              message
            });

            const io = getIO();
            io.to(hotel._id.toString()).emit('NOTIFICATION', { message });
            
            logger.info(`Hotel ${hotel.hotelName} earned compliance badge`);
          }
        }
      }
      
      logger.info('Hotel badge eligibility check complete');
    } catch (error) {
      logger.error(`Hotel badge check failed: ${error.message}`);
    }
  });

  logger.info('Scheduled jobs initialized');
}

module.exports = { startScheduledJobs };
