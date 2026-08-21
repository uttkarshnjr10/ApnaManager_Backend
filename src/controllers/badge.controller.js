const Hotel = require('../models/hotel.model');
const Guest = require('../models/guest.model');
const asyncHandler = require('express-async-handler');
const ApiError = require('../utils/api-error');
const ApiResponse = require('../utils/api-response');
const QRCode = require('qrcode');

/**
 * @desc Get hotel badge status
 * @route GET /api/badge/status
 * @access Protected (Hotel only)
 */
const getBadgeStatus = asyncHandler(async (req, res) => {
  const hotelId = req.user._id;
  const hotel = await Hotel.findById(hotelId);

  if (!hotel) {
    throw new ApiError(404, 'Hotel not found');
  }

  const now = Date.now();
  const daysActive = Math.floor((now - hotel.createdAt.getTime()) / 86400000);
  
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const guestCount = await Guest.countDocuments({
    hotel: hotelId,
    registrationTimestamp: { $gte: thirtyDaysAgo }
  });

  res.status(200).json(new ApiResponse(200, {
    eligible: hotel.badgeEligible,
    verificationCode: hotel.verificationCode || null,
    verifiedAt: hotel.verifiedAt || null,
    requirements: {
      daysActive,
      daysRequired: 30,
      guestCount,
      guestsRequired: 10
    }
  }, 'Badge status retrieved'));
});

/**
 * @desc Generate and download badge SVG
 * @route GET /api/badge/download
 * @access Protected (Hotel only)
 */
const generateBadgeSVG = asyncHandler(async (req, res) => {
  const hotelId = req.user._id;
  const hotel = await Hotel.findById(hotelId);

  if (!hotel || !hotel.badgeEligible) {
    throw new ApiError(403, 'Badge not yet available');
  }

  const verifyUrl = `https://apnaregister.in/verify/${hotel.verificationCode}`;
  
  // Generate QR code as data URL
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
    width: 80,
    margin: 1,
    color: {
      dark: '#1D4ED8', // blue-700
      light: '#FFFFFF'
    }
  });

  const svg = `
<svg width="300" height="400" xmlns="http://www.w3.org/2000/svg">
  <rect x="5" y="5" width="290" height="390" rx="15" fill="#ffffff" stroke="#1D4ED8" stroke-width="3"/>
  
  <!-- Header -->
  <text x="150" y="50" font-family="Arial, sans-serif" font-size="24" font-weight="bold" fill="#1D4ED8" text-anchor="middle">
    APNA REGISTER
  </text>
  <text x="150" y="75" font-family="Arial, sans-serif" font-size="14" fill="#64748B" text-anchor="middle">
    Verified Digital Registration
  </text>
  
  <line x1="20" y1="95" x2="280" y2="95" stroke="#E2E8F0" stroke-width="2"/>
  
  <!-- Hotel Name -->
  <text x="150" y="145" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#1E293B" text-anchor="middle">
    ${hotel.hotelName}
  </text>
  
  <!-- Compliance Text & Icon -->
  <g transform="translate(150, 185)">
    <path d="M -100 0 L -85 15 L -65 -15" stroke="#10B981" stroke-width="4" fill="none" />
    <text x="-50" y="5" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#10B981" text-anchor="start">
      DPDP Act 2023 Compliant
    </text>
  </g>
  
  <text x="150" y="225" font-family="Arial, sans-serif" font-size="12" fill="#64748B" text-anchor="middle">
    Member since ${hotel.createdAt.getFullYear()}
  </text>

  <line x1="20" y1="265" x2="280" y2="265" stroke="#E2E8F0" stroke-width="2"/>

  <!-- Footer with QR -->
  <image href="${qrDataUrl}" x="180" y="280" width="80" height="80"/>
  
  <text x="25" y="315" font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="#64748B" text-anchor="start">
    VERIFICATION CODE:
  </text>
  <text x="25" y="335" font-family="monospace" font-size="14" font-weight="bold" fill="#0F172A" text-anchor="start">
    ${hotel.verificationCode}
  </text>
  <text x="25" y="355" font-family="Arial, sans-serif" font-size="9" fill="#94A3B8" text-anchor="start">
    Scan QR to verify on Apna Register
  </text>
</svg>
  `.trim();

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Content-Disposition', 'attachment; filename="apnaregister-badge.svg"');
  res.send(svg);
});

/**
 * @desc Public verify hotel badge
 * @route GET /api/public/verify/:code
 * @access Public
 */
const verifyHotelBadge = asyncHandler(async (req, res) => {
  const code = req.params.code;

  if (!code) {
    throw new ApiError(400, 'Verification code is required');
  }

  // Find hotel matching the code (case-insensitive)
  const hotel = await Hotel.findOne({
    verificationCode: { $regex: new RegExp(`^${code}$`, 'i') },
    badgeEligible: true
  }).lean();

  if (!hotel) {
    return res.status(404).json({
      valid: false,
      message: "Verification code not found"
    });
  }

  res.status(200).json({
    valid: true,
    hotelName: hotel.hotelName,
    city: hotel.city,
    state: hotel.state,
    verifiedSince: hotel.verifiedAt,
    platformName: "Apna Register",
    compliance: "DPDP Act 2023 Compliant Digital Registration",
    message: "This hotel is a verified partner using Apna Register's compliant digital guest registration system."
  });
});

module.exports = {
  getBadgeStatus,
  generateBadgeSVG,
  verifyHotelBadge
};
