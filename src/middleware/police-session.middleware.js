// src/middleware/police-session.middleware.js
const PoliceSession = require('../models/police-session.model');
const asyncHandler = require('../utils/async-handler');
const ApiError = require('../utils/api-error');

/**
 * Middleware: Require a valid (non-expired) photo verification session.
 *
 * Checks the PoliceSession collection for an active session belonging
 * to the authenticated officer. If none exists or all have expired,
 * returns 403 with the code 'VERIFICATION_REQUIRED' so the frontend
 * can show the webcam gate instead of a generic error.
 *
 * Attaches the session document to `req.verificationSession` for
 * downstream audit logging if needed.
 */
const requireVerifiedSession = asyncHandler(async (req, res, next) => {
  const session = await PoliceSession.findOne({
    officer: req.user._id,
    expiresAt: { $gt: new Date() },
  })
    .sort({ expiresAt: -1 }) // Pick the latest active session
    .lean();

  if (!session) {
    throw new ApiError(403, 'VERIFICATION_REQUIRED');
  }

  // Attach for optional audit use in downstream controllers
  req.verificationSession = session;
  next();
});

module.exports = { requireVerifiedSession };
