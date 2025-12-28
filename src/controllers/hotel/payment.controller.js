const { User, HotelUser } = require('../../models/User.model');
const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/ApiError');
const logger = require('../../utils/logger');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// 1. CREATE SUBSCRIPTION SESSION
const createSubscriptionSession = asyncHandler(async (req, res) => {
    const { priceId } = req.body; // e.g., 'price_123abc' from your Stripe dashboard
    const user = await HotelUser.findById(req.user.id);

    if (!user) {
        throw new ApiError(404, 'User not found');
    }

    let stripeCustomerId = user.stripeCustomerId;

    // 1. Create a Stripe Customer if one doesn't exist
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

    const frontendUrl = process.env.CORS_ALLOWED_ORIGINS.split(',')[0];

    // 2. Create a Checkout Session
    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription',
        customer: stripeCustomerId,
        line_items: [
            {
                price: priceId, // The ID of the plan you created in Stripe
                quantity: 1,
            },
        ],
        success_url: `${frontendUrl}/hotel/subscription-success`,
        cancel_url: `${frontendUrl}/hotel/subscription`,
    });

    // 3. Send the session URL back to the frontend
    res.status(200).json({ url: session.url });
});

// 2. HANDLE STRIPE WEBHOOKS
// This is how Stripe tells you a payment was successful.
// You requested to do this part later, but it's CRITICAL.
// For now, we'll just log it.
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

    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed':
        case 'invoice.payment_succeeded':
            const session = event.data.object;
            // TODO: This is where you'll update your database
            // Find user by session.customer, update their
            // subscriptionStatus and subscriptionPeriodEnd.
            logger.info(`Payment success for Stripe Customer: ${session.customer}`);
            break;
        case 'invoice.payment_failed':
            // TODO: Handle failed payment
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