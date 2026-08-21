const sgMail = require('@sendgrid/mail');
const logger = require('./logger');
const credentialsTemplate = require('./email-templates/credentials.template');
const checkoutTemplate = require('./email-templates/checkout.template');
const resetPasswordTemplate = require('./email-templates/reset-password.template');

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
      name: 'Apna Register Admin',
      email: fromEmail,
    },
    subject: 'Your GuestGuard Account Credentials',
    html: credentialsTemplate(username, temporaryPassword),
  };
  await sendEmail(msg, 'credentials');
};

const sendCheckoutEmail = async (toEmail, hotelEmail, guestObject, pdfBuffer) => {
  const hotelName = guestObject.hotel?.hotelName || guestObject.hotel?.username || 'Your Hotel';
  const guestName = guestObject.primaryGuest?.name || 'Guest';
  const msg = {
    to: [toEmail, hotelEmail],
    from: {
      name: `${hotelName} (via Apna Register)`,
      email: fromEmail,
    },
    subject: `Your Checkout Receipt from ${hotelName}`,
    html: checkoutTemplate(guestObject),
    attachments: [
      {
        content: pdfBuffer.toString('base64'),
        filename: `checkout_receipt_${guestName.replace(/\s+/g, '_')}.pdf`,
        type: 'application/pdf',
        disposition: 'attachment',
      },
    ],
  };
  await sendEmail(msg, 'checkout receipt');
};

const sendPasswordResetEmail = async (toEmail, username, resetUrl) => {
  const msg = {
    to: toEmail,
    from: {
      name: 'Apna Register Support',
      email: fromEmail,
    },
    subject: 'Your Password Reset Link',
    html: resetPasswordTemplate(username, resetUrl),
  };
  await sendEmail(msg, 'password reset');
};

const sendPortalOTPEmail = async (toEmail, otp) => {
  const msg = {
    to: toEmail,
    from: {
      name: 'Apna Register Data Portal',
      email: fromEmail,
    },
    subject: 'Your Data Portal Verification Code',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #2563eb; padding: 20px; text-align: center;">
          <h2 style="color: #ffffff; margin: 0;">Apna Register</h2>
        </div>
        <div style="padding: 24px;">
          <p style="font-size: 16px; color: #333;">Hello,</p>
          <p style="font-size: 16px; color: #333;">Please use the following 6-digit code to access the Guest Data Portal. This code will expire in 10 minutes.</p>
          <div style="text-align: center; margin: 32px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1e40af; background: #eff6ff; padding: 12px 24px; border-radius: 8px;">${otp}</span>
          </div>
          <p style="font-size: 14px; color: #666; margin-top: 24px;">If you did not request this code, please ignore this email.</p>
        </div>
      </div>
    `,
  };
  await sendEmail(msg, 'portal OTP');
};

module.exports = { sendCredentialsEmail, sendCheckoutEmail, sendPasswordResetEmail, sendPortalOTPEmail };
