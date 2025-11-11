const sgMail = require('@sendgrid/mail');
const logger = require('./logger');
const credentialsTemplate = require('./emailTemplates/credentialsTemplate');
const checkoutTemplate = require('./emailTemplates/checkoutTemplate');
const resetPasswordTemplate = require('./emailTemplates/resetPasswordTemplate');

if (!process.env.SENDGRID_API_KEY || !process.env.FROM_EMAIL) {
    logger.error('sendgrid api key or from_email is not defined in environment variables.');
    if (process.env.NODE_ENV === 'production') {
        process.exit(1);
    }
} else {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const fromEmail = process.env.FROM_EMAIL;

// Simplified main email function
const sendEmail = async (msg, logContext) => {
    try {
        await sgMail.send(msg); 
        const recipients = Array.isArray(msg.to) ? msg.to.join(', ') : msg.to;
        logger.info(`${logContext} email sent successfully to ${recipients}`);
    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.body) : error.message;
        logger.error(`failed to send ${logContext} email to ${msg.to}: ${errorMessage}`);
    }
};

// Updated function to create the full `from` object
const sendCredentialsEmail = async (toEmail, username, temporaryPassword) => {
    const msg = {
        to: toEmail,
        from: {
            name: 'ApnaManager Admin',
            email: fromEmail, 
        },
        subject: 'Your GuestGuard Account Credentials',
        html: credentialsTemplate(username, temporaryPassword),
    };
    await sendEmail(msg, 'credentials');
};

const sendCheckoutEmail = async (toEmail, hotelEmail, guestName, hotelName, pdfBuffer) => {
    const msg = {
        to: [toEmail, hotelEmail],
        from: {
            name: `${hotelName} (via ApnaManager)`,
            email: fromEmail, 
        },
        subject: `Your Checkout Receipt from ${hotelName}`,
        html: checkoutTemplate(guestName, hotelName),
        attachments: [{
            content: pdfBuffer.toString('base64'),
            filename: `checkout_receipt_${guestName.replace(/\s+/g, '_')}.pdf`,
            type: 'application/pdf',
            disposition: 'attachment',
        }],
    };
    await sendEmail(msg, 'checkout receipt');
};

const sendPasswordResetEmail = async (toEmail, username, resetUrl) => {
    const msg = {
        to: toEmail,
        from: {
            name: 'ApnaManager Support',
            email: fromEmail,
        },
        subject: 'Your Password Reset Link',
        html: resetPasswordTemplate(username, resetUrl),
    };
    await sendEmail(msg, 'password reset');
};

module.exports = { sendCredentialsEmail, sendCheckoutEmail, sendPasswordResetEmail };