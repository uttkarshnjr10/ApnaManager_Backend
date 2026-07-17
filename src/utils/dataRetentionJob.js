const Guest = require('../models/guest.model');
const AccessLog = require('../models/access-log.model');
const cloudinary = require('cloudinary').v2;
const logger = require('./logger');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const safelyDestroyImage = async (imageField) => {
  if (imageField && imageField.public_id) {
    try {
      await cloudinary.uploader.destroy(imageField.public_id);
      await delay(100); // Wait 100ms between deletions to respect rate limits
    } catch (error) {
      logger.error(`Cloudinary deletion failed for ${imageField.public_id}: ${error.message}`);
    }
  }
};

const runDataRetentionJob = async () => {
  try {
    const expiredGuests = await Guest.find({
      isAnonymized: false,
      status: 'Checked-Out',
      retentionExpiresAt: { $lte: new Date() }
    }).select('_id idImageFront idImageBack livePhoto accompanyingGuests customerId hotel consentRecord');

    if (expiredGuests.length === 0) {
      logger.info('Retention job: 0 records to process');
      return;
    }

    logger.info(`Retention job: Found ${expiredGuests.length} records to process`);

    for (const guest of expiredGuests) {
      // a) Delete images from Cloudinary securely
      await safelyDestroyImage(guest.idImageFront);
      await safelyDestroyImage(guest.idImageBack);
      await safelyDestroyImage(guest.livePhoto);

      // Delete images for accompanying adults
      if (guest.accompanyingGuests && Array.isArray(guest.accompanyingGuests.adults)) {
        for (const adult of guest.accompanyingGuests.adults) {
          await safelyDestroyImage(adult.idImageFront);
          await safelyDestroyImage(adult.idImageBack);
          await safelyDestroyImage(adult.livePhoto);
        }
      }

      // Delete images for accompanying children
      if (guest.accompanyingGuests && Array.isArray(guest.accompanyingGuests.children)) {
        for (const child of guest.accompanyingGuests.children) {
          await safelyDestroyImage(child.idImageFront);
          await safelyDestroyImage(child.idImageBack);
          await safelyDestroyImage(child.livePhoto);
        }
      }

      // b) Update the guest document with anonymized data
      await Guest.findByIdAndUpdate(guest._id, {
        'primaryGuest.name': 'ANONYMIZED',
        'primaryGuest.phone': null,
        'primaryGuest.email': null,
        'primaryGuest.address.street': null,
        'primaryGuest.address.city': null,
        'primaryGuest.address.state': null,
        'primaryGuest.address.zipCode': null,
        
        idNumber: 'ANONYMIZED',
        
        idImageFront: { url: null, public_id: null },
        idImageBack: { url: null, public_id: null },
        livePhoto: { url: null, public_id: null },
        
        'accompanyingGuests.adults': [],
        'accompanyingGuests.children': [],
        
        isAnonymized: true,
        anonymizedAt: new Date(),
        
        // Keep hash but remove personal signature details if any (textHash is what we keep)
        'consentRecord.textHash': guest.consentRecord?.textHash
      });

      // c) Create AccessLog entry
      await AccessLog.create({
        action: 'GUEST_DATA_ANONYMIZED',
        reason: 'Automated retention policy - 3 year period expired',
        user: null, // System action
        userModel: 'RegionalAdmin'
      });
    }

    logger.info(`Retention job complete: ${expiredGuests.length} records anonymized`);
  } catch (error) {
    logger.error(`Retention job failed critically: ${error.message}`);
  }
};

module.exports = { runDataRetentionJob };
