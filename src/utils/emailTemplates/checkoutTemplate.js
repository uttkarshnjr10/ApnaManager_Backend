// src/utils/emailTemplates/checkoutTemplate.js

/**
 * @param {object} guest - The full guest Mongoose document.
 */
const checkoutTemplate = (guest) => {
  const guestName = guest.primaryGuest?.name || 'Guest';
  const hotelName = guest.hotel?.hotelName || 'our partner hotel';

  // Format dates for a friendly look
  const checkInDate = new Date(guest.stayDetails.checkIn).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const checkOutDate = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      body {
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 0;
        background-color: #f4f7f6;
      }
      .container {
        max-width: 600px;
        margin: 20px auto;
        background-color: #ffffff;
        border-radius: 12px;
        overflow: hidden;
        border: 1px solid #dee5e8;
      }
      .header {
        background-color: #e6f2ff;
        padding: 40px;
        text-align: center;
      }
      .header h1 {
        margin: 0;
        font-size: 28px;
        color: #0d47a1;
      }
      .body {
        padding: 30px 40px;
        color: #333;
        line-height: 1.6;
      }
      .body p {
        margin-bottom: 20px;
      }
      .info-box {
        background-color: #f9f9f9;
        padding: 20px;
        border-radius: 8px;
        border: 1px solid #eee;
      }
      .footer {
        padding: 30px 40px;
        text-align: center;
        color: #888;
        font-size: 12px;
        background-color: #fcfcfc;
        border-top: 1px solid #eee;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>Thank You for Your Stay!</h1>
      </div>
      <div class="body">
        <p>Hi ${guestName},</p>
        <p>We hope you had a wonderful time at <strong>${hotelName}</strong>. Your checkout has been successfully processed.</p>
        <p>For your convenience, we have attached a detailed PDF receipt of your stay (from ${checkInDate} to ${checkOutDate}).</p>
        
        <div class="info-box">
          We wish you safe travels on your onward journey and look forward to welcoming you back again soon. 👋
        </div>
        
        <p style="margin-top: 30px;">
          Best regards,<br>
          The ApnaManager Team
        </p>
      </div>
      <div class="footer">
        This is an automated receipt sent on behalf of ${hotelName} via ApnaManager.
      </div>
    </div>
  </body>
  </html>
  `;
};

module.exports = checkoutTemplate;
