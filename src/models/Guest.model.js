// src/models/Guest.model.js
const mongoose = require('mongoose');
const { randomBytes } = require('crypto');

// Reusable Image Schema (Url + Public ID)
const imageSchema = {
  url: { type: String, required: true },
  public_id: { type: String, required: true },
};

// Optional Image Schema (for guests who might not have some photos)
const optionalImageSchema = {
  url: { type: String },
  public_id: { type: String },
};

const individualGuestSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    dob: { type: Date, required: true },
    gender: { type: String, required: true, enum: ['Male', 'Female', 'Other'] },
    phone: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    address: {
      street: { type: String, trim: true },
      city: { type: String, required: true, trim: true },
      state: { type: String, trim: true },
      zipCode: { type: String, trim: true },
    },
  },
  { _id: false }
);

const guestSchema = new mongoose.Schema({
  customerId: {
    type: String,
    unique: true,
    required: true,
  },
  primaryGuest: {
    type: individualGuestSchema,
    required: true,
  },
  idType: { type: String, required: true },
  idNumber: { type: String, required: true, trim: true },

  idImageFront: imageSchema,
  idImageBack: imageSchema,
  livePhoto: imageSchema,

  accompanyingGuests: {
    adults: [
      {
        name: { type: String, required: true, trim: true },
        dob: { type: Date, required: true },
        gender: { type: String, required: true, enum: ['Male', 'Female', 'Other'] },
        livePhoto: optionalImageSchema,
        idType: { type: String },
        idNumber: { type: String, trim: true },
        idImageFront: optionalImageSchema,
        idImageBack: optionalImageSchema,
        _id: false,
      },
    ],
    children: [
      {
        name: { type: String, required: true, trim: true },
        dob: { type: Date, required: true },
        gender: { type: String, required: true, enum: ['Male', 'Female', 'Other'] },
        livePhoto: optionalImageSchema,
        idType: { type: String },
        idNumber: { type: String, trim: true },
        idImageFront: optionalImageSchema,
        idImageBack: optionalImageSchema,
        _id: false,
      },
    ],
  },
  stayDetails: {
    purposeOfVisit: { type: String, required: true, trim: true },
    checkIn: { type: Date, default: Date.now },
    expectedCheckout: { type: Date, required: true },
    roomNumber: { type: String, trim: true },
    checkOut: { type: Date },
  },
  hotel: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hotel',
    required: true,
  },
  status: {
    type: String,
    enum: ['Checked-In', 'Checked-Out'],
    default: 'Checked-In',
  },
  registrationTimestamp: {
    type: Date,
    default: Date.now,
  },
});

// ============================================================
// PERFORMANCE OPTIMIZATION: INDEXES
// ============================================================

// CRITICAL: Index for getAllGuests query (hotel + timestamp sorting)
// Without this, queries on 1000+ guests will be extremely slow
guestSchema.index({ hotel: 1, registrationTimestamp: -1 });

// Index for filtering by hotel and status
guestSchema.index({ hotel: 1, status: 1 });

// Index for date range queries (reports)
guestSchema.index({ hotel: 1, 'stayDetails.checkIn': 1 });

// Index for room lookups
guestSchema.index({ 'stayDetails.roomNumber': 1, hotel: 1 });

// CRITICAL: Indexes for watchlist checks (fast lookups)
guestSchema.index({ idNumber: 1 });
guestSchema.index({ 'primaryGuest.phone': 1 });

// Index for customerId lookups
guestSchema.index({ customerId: 1 });

// ============================================================
// MIDDLEWARE
// ============================================================

guestSchema.pre('validate', function (next) {
  if (this.isNew) {
    this.customerId = `G-${randomBytes(3).toString('hex').toUpperCase()}`;
  }
  next();
});

const Guest = mongoose.model('Guest', guestSchema);
module.exports = Guest;
