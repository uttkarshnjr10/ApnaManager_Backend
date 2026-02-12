const mongoose = require('mongoose');
const {
  baseAuthFields,
  preSaveHashPassword,
  matchPasswordMethod,
  createPasswordResetTokenMethod,
} = require('./schemas/baseAuth.schema');

const roomSchema = new mongoose.Schema({
  roomNumber: { type: String, required: true, trim: true },
  status: { type: String, enum: ['Vacant', 'Occupied', 'Maintenance'], default: 'Vacant' },
  guestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Guest', default: null },
});

const hotelSchema = new mongoose.Schema(
  {
    ...baseAuthFields, // Spread the common auth fields here

    // Hotel Specific Fields
    hotelName: { type: String, trim: true, required: true },
    ownerName: { type: String, trim: true },
    gstNumber: { type: String, trim: true },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
    state: { type: String, trim: true },
    pinCode: { type: String, trim: true },
    nationality: { type: String, trim: true, default: 'Indian' },
    postOffice: { type: String, trim: true },
    localThana: { type: String, trim: true },
    pinLocation: { type: String, trim: true },

    // Using Objects for Images (RBAC Ready)
    ownerSignature: { public_id: String, url: String },
    hotelStamp: { public_id: String, url: String },
    aadhaarCard: { public_id: String, url: String },

    stripeCustomerId: { type: String, trim: true },
    subscriptionStatus: {
      type: String,
      enum: ['Active', 'Canceled', 'Past Due', 'Inactive'],
      default: 'Inactive',
    },
    subscriptionPeriodEnd: { type: Date },
    rooms: [roomSchema],
  },
  { timestamps: true }
);

// Attach Auth Methods
hotelSchema.pre('save', preSaveHashPassword);
hotelSchema.methods.matchPassword = matchPasswordMethod;
hotelSchema.methods.createPasswordResetToken = createPasswordResetTokenMethod;

const Hotel = mongoose.model('Hotel', hotelSchema);
module.exports = Hotel;
