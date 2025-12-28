const express = require('express');
const router = express.Router();
const { 
    searchGuests, 
    getDashboardData,
    createAlert,
    getAlerts,
    resolveAlert,
    getGuestHistory,
    addRemark,
    createCaseReport, 
    getCaseReports,
    getHotelList,        
    advancedGuestSearch,
} = require('../../controllers/police/police.controller'); 
const { protect, authorize } = require('../../middleware/auth.middleware'); 

router.use(protect);
router.use(authorize('Police', 'Admin'));

router.get('/dashboard', getDashboardData);
router.get('/search', searchGuests);
router.get('/advanced-search', advancedGuestSearch);
router.get('/guest-history/:guestId', getGuestHistory); 
router.post('/guest-history/:guestId/remark', addRemark); 
router.post('/alerts', createAlert);
router.get('/alerts', getAlerts);
router.patch('/alerts/:id/resolve', resolveAlert);
router.post('/cases', createCaseReport);
router.get('/cases', getCaseReports);
router.get('/hotels', getHotelList);

module.exports = router;