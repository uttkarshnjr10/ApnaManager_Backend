const express = require('express');
const router = express.Router();
const { createSubscriptionSession, handleStripeWebhook } = require('../../controllers/hotel/payment.controller');
const { protect, authorize } = require('../../middleware/auth.middleware'); 

router.post('/create-session', protect, authorize('Hotel'), createSubscriptionSession);
router.post('/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

module.exports = router;