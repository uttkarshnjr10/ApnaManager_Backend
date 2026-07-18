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
    nationality: { type: String, trim: true, default: 'Indian' },
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

  // ── DPDP Act 2023 Consent Record ──────────────────────────────
  consentRecord: {
    signatureImage: { type: String },               // base64 PNG of the trimmed signature
    consentTextVersion: { type: String },            // version identifier of the shown consent text
    consentHash: { type: String },                   // SHA-256 hex of (consentTextVersion + timestamp)
    signedAt: { type: Date },                        // ISO timestamp of signature capture
    consentGranted: { type: Boolean, default: false },
  },

  // ── C-Form Status for Foreign Nationals ──────────────────────────────
  cForm: {
    status: { 
      type: String, 
      enum: ['not_required', 'pending', 'generated', 'submitted', 'failed'],
      default: 'not_required'
    },
    pdfUrl: { type: String },
    pdfPublicId: { type: String },
    generatedAt: { type: Date },
    submittedAt: { type: Date },
    submittedBy: { type: String }
  },

  status: {
    type: String,
    enum: ['Checked-In', 'Checked-Out'],
    default: 'Checked-In',
  },
  retentionExpiresAt: {
    type: Date,
    index: true
  },
  isAnonymized: {
    type: Boolean,
    default: false,
    index: true
  },
  anonymizedAt: {
    type: Date
  },
  deletionRequestedAt: {
    type: Date
  },
  deletionScheduledFor: {
    type: Date
  },
  registrationTimestamp: {
    type: Date,
    default: Date.now,
  },

  // ── Unified search fields (auto-populated by pre-save hook) ──
  // These fields aggregate identifiers from the primary guest AND all
  // accompanying guests so that a single indexed query can find a booking
  // regardless of which person inside it matches.
  allIdNumbers: [{ type: String, trim: true }],
  allNames: [{ type: String, trim: true }],
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

// Unified search indexes — enables fast $in and regex lookups across all persons
guestSchema.index({ allIdNumbers: 1 });
guestSchema.index({ allNames: 1 });

// ============================================================
// MIDDLEWARE
// ============================================================

guestSchema.pre('validate', function (next) {
  if (this.isNew) {
    this.customerId = `G-${randomBytes(3).toString('hex').toUpperCase()}`;
    
    // Automatically flag foreign nationals for C-Form generation
    if (
      this.primaryGuest?.nationality && 
      this.primaryGuest.nationality.trim().toLowerCase() !== 'indian'
    ) {
      this.cForm = { status: 'pending' };
    }
  }
  next();
});

/**
 * Pre-save hook: Auto-populate unified search arrays.
 * Runs on every save so that allIdNumbers/allNames always stay in sync
 * with the primary guest and accompanying guest sub-documents.
 */
guestSchema.pre('save', function (next) {
  // ── Collect all ID numbers ──
  const ids = new Set();
  if (this.idNumber) ids.add(this.idNumber.trim());

  const addIdsFrom = (arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((g) => {
      if (g.idNumber) ids.add(g.idNumber.trim());
    });
  };
  addIdsFrom(this.accompanyingGuests?.adults);
  addIdsFrom(this.accompanyingGuests?.children);

  this.allIdNumbers = [...ids];

  // ── Collect all names ──
  const names = new Set();
  if (this.primaryGuest?.name) names.add(this.primaryGuest.name.trim());

  const addNamesFrom = (arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((g) => {
      if (g.name) names.add(g.name.trim());
    });
  };
  addNamesFrom(this.accompanyingGuests?.adults);
  addNamesFrom(this.accompanyingGuests?.children);

  this.allNames = [...names];

  next();
});

const Guest = mongoose.model('Guest', guestSchema);
module.exports = Guest;

