const mongoose = require('mongoose');

const hotelInquirySchema = new mongoose.Schema(
  {
    hotelName: { type: String, required: true },
    gstNumber: { type: String, required: true },
    ownerName: { type: String, required: true },
    email: { type: String, required: true, lowercase: true },
    mobileNumber: { type: String, required: true },
    // address
    nationality: { type: String, default: 'Indian' },
    state: { type: String, required: true },
    district: { type: String, required: true },
    postOffice: { type: String, required: true },
    pinCode: { type: String, required: true },
    localThana: { type: String, required: true },
    fullAddress: { type: String, required: true },
    pinLocation: { type: String },

    ownerSignature: {
      public_id: String,
      url: String,
    },
    hotelStamp: {
      public_id: String,
      url: String,
    },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    aadhaarCard: {
      public_id: String,
      url: String,
    },
  },
  { timestamps: true }
);

const HotelInquiry = mongoose.model('HotelInquiry', hotelInquirySchema);

module.exports = HotelInquiry;
