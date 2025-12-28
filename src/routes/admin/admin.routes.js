// // src/routes/admin/admin.routes.js
// const express = require('express');
// const router = express.Router();
// const { 
//     registerUser, 
//     getAdminDashboardData,
//     getHotelUsers,
//     getPoliceUsers,
//     updateUserStatus,
//     deleteUser,
//     getAccessLogs
// } = require('../../controllers/admin/admin.controller'); 

// // 1. Change 'adminOnly' to 'authorize' here:
// const { protect, authorize } = require('../../middleware/auth.middleware');

// // All routes here require Admin access
// router.use(protect);

// // 2. Use authorize('Admin') here instead of adminOnly:
// router.use(authorize('Admin'));

// router.post('/register', registerUser);
// router.get('/dashboard', getAdminDashboardData);
// router.get('/hotels', getHotelUsers);
// router.get('/police', getPoliceUsers);
// router.patch('/status/:id', updateUserStatus);
// router.delete('/:id', deleteUser);
// router.get('/logs', getAccessLogs);

// module.exports = router;

// src/routes/admin/admin.routes.js
const express = require('express');
const router = express.Router();
const { 
    registerUser, 
    getAdminDashboardData,
    getHotelUsers,
    getPoliceUsers,
    updateUserStatus,
    deleteUser,
    getAccessLogs
} = require('../../controllers/admin/admin.controller'); 
const { protect, authorize } = require('../../middleware/auth.middleware');

// Apply protection to all routes
router.use(protect);

// FIX: Allow both 'Admin' AND 'Regional Admin'
router.use(authorize('Admin', 'Regional Admin')); 

router.post('/register', registerUser);
router.get('/dashboard', getAdminDashboardData);
router.get('/hotels', getHotelUsers);
router.get('/police', getPoliceUsers);
router.patch('/status/:id', updateUserStatus);
router.delete('/:id', deleteUser);
router.get('/logs', getAccessLogs);

module.exports = router;