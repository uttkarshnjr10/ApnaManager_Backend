const express = require('express');
const router = express.Router();
const {
  getMyRooms,
  addRoom,
  deleteRoom,
  updateRoom,
  getRoomDashboardStats
} = require('../../controllers/hotel/room.controller'); 
const { protect, authorize } = require('../../middleware/auth.middleware'); 

router.get('/', protect, authorize('Hotel'), getMyRooms);
router.post('/', protect, authorize('Hotel'), addRoom);
router.delete('/:id', protect, authorize('Hotel'), deleteRoom);
router.put('/:id', protect, authorize('Hotel'), updateRoom);
router.get('/stats', protect, authorize('Hotel'), getRoomDashboardStats);

module.exports = router;