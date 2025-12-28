const PoliceStation = require('../../models/PoliceStation.model');
const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/ApiError');
const ApiResponse = require('../../utils/ApiResponse');
const logger = require('../../utils/logger');

const createStation = asyncHandler(async (req, res) => {
    const { name, city, pincodes } = req.body;

    if (!name || !city || !pincodes || pincodes.length === 0) {
        throw new ApiError(400, 'name, city, and at least one pincode are required');
    }

    const stationExists = await PoliceStation.findOne({ name });
    if (stationExists) {
        throw new ApiError(400, 'a police station with this name already exists');
    }

    const pincodesArray = Array.isArray(pincodes) ? pincodes : pincodes.split(',').map(p => p.trim());

    const station = await PoliceStation.create({
        name,
        city,
        pincodes: pincodesArray,
    });

    logger.info(`new police station created: ${name}`);
    res
    .status(201)
    .json(new ApiResponse(201, station, 'police station created successfully'));
});

const getAllStations = asyncHandler(async (req, res) => {
    const stations = await PoliceStation.find({}).select('name _id city pincodes');
    res
    .status(200)
    .json(new ApiResponse(200, stations));
});

module.exports = { createStation, getAllStations };