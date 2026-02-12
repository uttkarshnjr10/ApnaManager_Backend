const express = require('express');
const router = express.Router();
const {
  createSubscriptionSession,
  handleStripeWebhook,
} = require('../controllers/payment.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

// Protected route for logged-in hotel users
router.post('/create-subscription-session', protect, authorize('Hotel'), createSubscriptionSession);

// Public route for Stripe to send us events
router.post(
  '/stripe-webhook',
  express.raw({ type: 'application/json' }), // We need the raw body
  handleStripeWebhook
);

module.exports = router;
