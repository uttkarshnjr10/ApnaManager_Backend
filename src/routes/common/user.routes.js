const express = require('express');
const router = express.Router();
const { 
    getUserProfile, 
    updateUserProfile, 
    updateUserPassword 
} = require('../../controllers/common/user.controller');

// Import Admin functions to support legacy URLs (/api/users/police, etc.)
const {
    registerUser,
    getPoliceUsers,
    updateUserStatus,
    deleteUser
} = require('../../controllers/admin/admin.controller');

const { protect, authorize } = require('../../middleware/auth.middleware');

// --- Standard User Routes ---
router.use(protect);

router.get('/profile', getUserProfile);
router.put('/profile', updateUserProfile);
router.put('/update-password', updateUserPassword);

// --- Legacy Admin Routes (Served at /api/users/...) ---
// These allow 'Regional Admin' as per your old code

router.post('/register', authorize('Regional Admin', 'Admin'), registerUser);
router.get('/police', authorize('Regional Admin', 'Admin'), getPoliceUsers);
router.patch('/:id/status', authorize('Regional Admin', 'Admin'), updateUserStatus);
router.delete('/:id', authorize('Regional Admin', 'Admin'), deleteUser);

module.exports = router;