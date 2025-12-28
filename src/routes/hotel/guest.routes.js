const express = require('express');
const router = express.Router();
const {
    registerGuest,
    checkoutGuest,
    getTodaysGuests,
    getAllGuests,
    generateGuestReport,
} = require('../../controllers/hotel/guest.controller'); 
const { protect, authorize } = require('../../middleware/auth.middleware'); 
const { photoUpload } = require('../../middleware/upload.middleware'); 

router.post('/register', protect, authorize('Hotel'), photoUpload.single('photo'), registerGuest);
router.post('/checkout/:guestId', protect, authorize('Hotel'), checkoutGuest);
router.get('/today', protect, authorize('Hotel'), getTodaysGuests);
router.get('/', protect, authorize('Hotel', 'Admin', 'Police'), getAllGuests);
router.get('/report', protect, authorize('Hotel', 'Admin', 'Police'), generateGuestReport);

module.exports = router;