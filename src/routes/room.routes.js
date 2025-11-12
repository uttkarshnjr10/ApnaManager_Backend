const express = require('express');
const router = express.Router();
const {
  getMyRooms,
  addRoom,
  deleteRoom,
  updateRoom,
  getRoomDashboardStats
} = require('../controllers/room.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

// All routes in this file are for logged-in Hotel users
router.use(protect, authorize('Hotel'));

// Get dashboard stats (Total, Occupied, Vacant)
router.get('/dashboard', getRoomDashboardStats);

router.route('/')
  .get(getMyRooms)   // Get all my rooms
  .post(addRoom);     // Add a new room

router.route('/:roomId')
  .put(updateRoom)    // Edit a room (e.g., rename "101" to "101-A")
  .delete(deleteRoom); // Delete a room

module.exports = router;