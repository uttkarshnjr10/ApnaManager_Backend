// src/utils/emailTemplates/checkoutTemplate.js
const checkoutTemplate = (guest) => {
  const { primaryGuest, stayDetails, hotel, accompanyingGuests } = guest;

  const adults = accompanyingGuests?.adults || [];
  const children = accompanyingGuests?.children || [];

  return `
  <div style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 30px;">
    <div style="max-width: 650px; margin: auto; background-color: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
      <div style="background-color: #1976D2; color: white; padding: 20px; text-align: center;">
        <h2 style="margin: 0;">Thank You for Staying with ${hotel?.details?.hotelName || 'Us'}!</h2>
      </div>

      <div style="padding: 25px;">
        <p style="font-size: 16px;">Dear <strong>${primaryGuest?.name}</strong>,</p>
        <p>Your checkout has been successfully processed. We truly appreciate your stay and hope you had a pleasant experience.</p>

        <h3 style="color: #1976D2; margin-top: 30px;">Stay Details</h3>
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
          <tr><td><strong>Hotel:</strong></td><td>${hotel?.details?.hotelName || 'N/A'}</td></tr>
          <tr><td><strong>Location:</strong></td><td>${hotel?.details?.city || 'N/A'}</td></tr>
          <tr><td><strong>Room Number:</strong></td><td>${stayDetails?.roomNumber || 'N/A'}</td></tr>
          <tr><td><strong>Check-In:</strong></td><td>${new Date(stayDetails?.checkIn).toLocaleString('en-IN')}</td></tr>
          <tr><td><strong>Expected Checkout:</strong></td><td>${new Date(stayDetails?.expectedCheckout).toLocaleString('en-IN')}</td></tr>
          <tr><td><strong>Purpose of Visit:</strong></td><td>${stayDetails?.purposeOfVisit || 'N/A'}</td></tr>
        </table>

        <h3 style="color: #1976D2; margin-top: 30px;">Primary Guest</h3>
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
          <tr><td><strong>Name:</strong></td><td>${primaryGuest?.name}</td></tr>
          <tr><td><strong>Gender:</strong></td><td>${primaryGuest?.gender}</td></tr>
          <tr><td><strong>Date of Birth:</strong></td><td>${new Date(primaryGuest?.dob).toLocaleDateString()}</td></tr>
          <tr><td><strong>Email:</strong></td><td>${primaryGuest?.email}</td></tr>
          <tr><td><strong>Phone:</strong></td><td>${primaryGuest?.phone}</td></tr>
        </table>

        ${adults.length > 0 || children.length > 0 ? `
          <h3 style="color: #1976D2; margin-top: 30px;">Accompanying Guests</h3>
          ${adults.length > 0 ? `
            <p><strong>Adults:</strong></p>
            <ul>${adults.map(a => `<li>${a.name} (${a.gender}, DOB: ${new Date(a.dob).toLocaleDateString()})</li>`).join('')}</ul>
          ` : ''}
          ${children.length > 0 ? `
            <p><strong>Children:</strong></p>
            <ul>${children.map(c => `<li>${c.name} (${c.gender}, DOB: ${new Date(c.dob).toLocaleDateString()})</li>`).join('')}</ul>
          ` : ''}
        ` : ''}

        <p style="margin-top: 40px; color: #555;">This is an automated receipt. Please do not reply to this email.</p>
        <p style="text-align: center; font-size: 14px; color: #1976D2; margin-top: 30px;">😊 Thank you for choosing us! We hope to welcome you again soon.</p>
      </div>
    </div>
  </div>
  `;
};

module.exports = checkoutTemplate;
