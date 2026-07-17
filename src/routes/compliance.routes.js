const express = require('express');
const router = express.Router();
const {
  createComplianceRequest,
  getAllComplianceRequests,
  getComplianceRequestById,
  searchGuestsForCompliance,
  exportComplianceData,
  rejectComplianceRequest,
  getComplianceStats
} = require('../controllers/compliance.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

router.post('/', protect, authorize('Regional Admin'), createComplianceRequest);
router.get('/', protect, authorize('Regional Admin'), getAllComplianceRequests);
router.get('/stats', protect, authorize('Regional Admin'), getComplianceStats);
router.get('/guests/search', protect, authorize('Regional Admin'), searchGuestsForCompliance);
router.get('/:id', protect, authorize('Regional Admin'), getComplianceRequestById);
router.post('/:id/export', protect, authorize('Regional Admin'), exportComplianceData);
router.put('/:id/reject', protect, authorize('Regional Admin'), rejectComplianceRequest);

module.exports = router;
