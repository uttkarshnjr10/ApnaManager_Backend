// 1. FIX: Import Hotel model directly
const Hotel = require('../models/Hotel.model');
const asyncHandler = require('express-async-handler');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const createSubscriptionSession = asyncHandler(async (req, res) => {
    const { priceId } = req.body;
    
    // 2. FIX: Use Hotel model
    const user = await Hotel.findById(req.user.id);

    if (!user) {
        throw new ApiError(404, 'User not found');
    }

    let stripeCustomerId = user.stripeCustomerId;

    if (!stripeCustomerId) {
        const customer = await stripe.customers.create({
            email: user.email,
            name: user.hotelName,
            metadata: {
                userId: user._id.toString(),
            },
        });
        stripeCustomerId = customer.id;
        user.stripeCustomerId = stripeCustomerId;
        await user.save();
    }

    // Fallback for dev environment if env var is missing
    const frontendUrl = process.env.CORS_ALLOWED_ORIGINS 
        ? process.env.CORS_ALLOWED_ORIGINS.split(',')[0] 
        : 'http://localhost:5173';

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription',
        customer: stripeCustomerId,
        line_items: [
            {
                price: priceId,
                quantity: 1,
            },
        ],
        success_url: `${frontendUrl}/hotel/subscription-success`,
        cancel_url: `${frontendUrl}/hotel/subscription`,
    });

    res.status(200).json({ url: session.url });
});

const handleStripeWebhook = asyncHandler(async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body, 
            sig, 
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        logger.error(`Stripe webhook error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
        case 'checkout.session.completed':
        case 'invoice.payment_succeeded':
            const session = event.data.object;
            // Future TODO: Update Hotel model here
            logger.info(`Payment success for Stripe Customer: ${session.customer}`);
            break;
        case 'invoice.payment_failed':
            logger.warn(`Payment failed for Stripe Customer: ${event.data.object.customer}`);
            break;
        default:
            logger.info(`Unhandled Stripe event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
});

module.exports = {
    createSubscriptionSession,
    handleStripeWebhook,
};