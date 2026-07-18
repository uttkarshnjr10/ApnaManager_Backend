const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const ApiError = require('../utils/api-error');

const {
  requestPortalOTP,
  verifyPortalOTP,
  getMyRecords,
  requestDeletion,
  downloadMyData
} = require('../controllers/guestPortal.controller');

const verifyPortalToken = (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    
    if (!token) {
      throw new ApiError(401, 'Not authorized, no portal token');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.portalPhone = decoded.phone;
    next();
  } catch (error) {
    next(new ApiError(401, 'Portal token failed or expired'));
  }
};

router.post('/verify', requestPortalOTP);
router.post('/confirm', verifyPortalOTP);
router.get('/records', verifyPortalToken, getMyRecords);
router.post('/delete-request', verifyPortalToken, requestDeletion);
router.get('/download/:recordId', verifyPortalToken, downloadMyData);

module.exports = router;
