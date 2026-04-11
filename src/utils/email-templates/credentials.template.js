// src/utils/emailTemplates/credentialsTemplate.js
const credentialsTemplate = (username, temporaryPassword) => {
  const frontendUrl = process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:5173';
  return `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
        <h2 style="color: #1976D2;">Welcome to GuestGuard!</h2>
        <p>An administrator has created an account for you. Please use the following credentials to log in for the first time.</p>
        <div style="background-color: #f4f4f4; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 0;"><strong>Username:</strong> ${username}</p>
          <p style="margin: 0;"><strong>Temporary Password:</strong> ${temporaryPassword}</p>
        </div>
        <p><strong>Important:</strong> For your security, you will be required to change this temporary password immediately upon your first login.</p>
        <a href="${frontendUrl}/login" style="display: inline-block; background-color: #1976D2; color: #fff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-size: 16px;">
          Login Now
        </a>
        <p style="font-size: 12px; color: #888; margin-top: 20px;">If you did not request this account, please ignore this email.</p>
      </div>
    `;
};

module.exports = credentialsTemplate;
