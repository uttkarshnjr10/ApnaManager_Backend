// 1. FIX: Import the new Hotel model
const Hotel = require('../models/Hotel.model');
const asyncHandler = require('express-async-handler');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const mongoose = require('mongoose');

const getMyRooms = asyncHandler(async (req, res) => {
  // 2. FIX: Use Hotel model
  const hotel = await Hotel.findById(req.user._id).select('rooms');
  if (!hotel) {
    throw new ApiError(404, 'Hotel not found');
  }
  res.status(200).json(new ApiResponse(200, hotel.rooms));
});

const addRoom = asyncHandler(async (req, res) => {
  const { roomNumber } = req.body;
  if (!roomNumber) {
    throw new ApiError(400, 'Room number/name is required');
  }

  const hotel = await Hotel.findById(req.user._id);
  if (!hotel) {
    throw new ApiError(404, 'Hotel not found');
  }

  // Check if room number already exists
  const roomExists = hotel.rooms.find((r) => r.roomNumber === roomNumber);
  if (roomExists) {
    throw new ApiError(400, 'A room with this number/name already exists');
  }

  const newRoom = {
    _id: new mongoose.Types.ObjectId(),
    roomNumber,
    status: 'Vacant',
    guestId: null,
  };

  hotel.rooms.push(newRoom);
  await hotel.save();

  res.status(201).json(new ApiResponse(201, newRoom, 'Room added successfully'));
});

const updateRoom = asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  const { roomNumber } = req.body;

  if (!roomNumber) {
    throw new ApiError(400, 'Room number is required');
  }

  const hotel = await Hotel.findById(req.user._id);
  // hotel.rooms is a Mongoose DocumentArray, so .id() works
  const room = hotel.rooms.id(roomId);

  if (!room) {
    throw new ApiError(404, 'Room not found');
  }
  if (room.status === 'Occupied') {
    throw new ApiError(400, 'Cannot edit an occupied room');
  }

  // Check for duplicate room number (excluding current room)
  const roomExists = hotel.rooms.find(
    (r) => r.roomNumber === roomNumber && r._id.toString() !== roomId
  );
  if (roomExists) {
    throw new ApiError(400, 'Another room with this number/name already exists');
  }

  room.roomNumber = roomNumber;
  await hotel.save();

  res.status(200).json(new ApiResponse(200, room, 'Room updated successfully'));
});

const deleteRoom = asyncHandler(async (req, res) => {
  const { roomId } = req.params;

  const hotel = await Hotel.findById(req.user._id);
  const room = hotel.rooms.id(roomId);

  if (!room) {
    throw new ApiError(404, 'Room not found');
  }
  if (room.status === 'Occupied') {
    throw new ApiError(400, 'Cannot delete an occupied room. Check the guest out first.');
  }

  // Remove the subdocument
  room.deleteOne();
  await hotel.save();

  res.status(200).json(new ApiResponse(200, null, 'Room deleted successfully'));
});

const getRoomDashboardStats = asyncHandler(async (req, res) => {
  const hotel = await Hotel.findById(req.user._id).select('rooms');
  if (!hotel) {
    throw new ApiError(404, 'Hotel not found');
  }

  const total = hotel.rooms.length;
  const occupied = hotel.rooms.filter((r) => r.status === 'Occupied').length;
  const vacant = total - occupied;
  const vacantRooms = hotel.rooms
    .filter((r) => r.status === 'Vacant')
    .map((r) => r.roomNumber)
    .sort();

  const stats = {
    total,
    occupied,
    vacant,
    vacantRooms,
  };

  res.status(200).json(new ApiResponse(200, stats));
});

module.exports = {
  getMyRooms,
  addRoom,
  deleteRoom,
  updateRoom,
  getRoomDashboardStats,
};
