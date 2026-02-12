// src/utils/emailTemplates/resetPasswordTemplate.js
const resetPasswordTemplate = (username, resetUrl) => {
  return `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
        <h2 style="color: #1976D2;">Password Reset Request</h2>
        <p>Hi ${username},</p>
        <p>We received a request to reset your password for your ApnaManager account. Please click the link below to set a new password:</p>
        <a href="${resetUrl}" style="display: inline-block; background-color: #1976D2; color: #fff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-size: 16px; margin: 20px 0;">
          Reset Your Password
        </a>
        <p>This link will expire in 10 minutes.</p>
        <p style="font-size: 12px; color: #888; margin-top: 20px;">If you did not request this, please ignore this email.</p>
      </div>
    `;
};

module.exports = resetPasswordTemplate;
