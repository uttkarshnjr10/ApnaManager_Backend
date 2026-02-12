// models/PoliceStation.model.js

const mongoose = require('mongoose');

const policeStationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    city: {
      type: String,
      required: true,
      trim: true,
    },
    // Array of pincodes this station has jurisdiction over
    pincodes: [
      {
        type: String,
        required: true,
        trim: true,
      },
    ],
  },
  { timestamps: true }
);

const PoliceStation = mongoose.model('PoliceStation', policeStationSchema);

module.exports = PoliceStation;
