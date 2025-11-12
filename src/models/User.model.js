const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto'); 

const options = {
  timestamps: true,
  discriminatorKey: 'role', 
};

const roomSchema = new mongoose.Schema({
  roomNumber: { // This is the name/number, e.g., "101" or "King Suite"
    type: String,
    required: true,
    trim: true,
  },
  status: {
    type: String,
    enum: ['Vacant', 'Occupied', 'Maintenance'],
    default: 'Vacant',
  },
  guestId: { // To link which guest is in which room
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Guest',
    default: null,
  }
}, { _id: true });


const baseUserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'username is required'],
      unique: true,
      trim: true,
      lowercase: true,
    },
    email: {
      type: String,
      required: [true, 'email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        'please provide a valid email address',
      ],
    },
    password: {
      type: String,
      required: [true, 'password is required'],
      minlength: [6, 'password must be at least 6 characters long'],
      select: false, 
    },
    passwordChangeRequired: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ['Active', 'Suspended'],
      default: 'Active',
    },
    
    passwordResetToken: String,
    passwordResetExpires: Date,
  },
  options
);

baseUserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

baseUserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

baseUserSchema.methods.createPasswordResetToken = function() {
  const resetToken = crypto.randomBytes(32).toString('hex');

  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

  return resetToken; // Return the unhashed token
};


const User = mongoose.model('User', baseUserSchema);

// 'Hotel' Discriminator

const HotelUser = User.discriminator(
  'Hotel',
  new mongoose.Schema({
    // Fields from inquiry
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
    ownerSignature: {
        public_id: String,
        url: String,
    },
    hotelStamp: {
        public_id: String,
        url: String,
    },
    aadhaarCard: {
        public_id: String,
        url: String,
    },

    stripeCustomerId: {
        type: String,
        trim: true,
    },
    subscriptionStatus: {
        type: String,
        enum: ['Active', 'Canceled', 'Past Due', 'Inactive'],
        default: 'Inactive',
    },
    subscriptionPeriodEnd: {
        type: Date,
    },
    rooms: [roomSchema]
  })
);

const PoliceUser = User.discriminator(
  'Police',
  new mongoose.Schema({
    jurisdiction: { type: String, trim: true },
    serviceId: { type: String, trim: true },
    rank: { type: String, trim: true },
    station: { type: String, trim: true },
    policeStation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PoliceStation',
      required: true,
    },
  })
);

// 'Regional Admin' Discriminator
const RegionalAdminUser = User.discriminator(
  'Regional Admin',
  new mongoose.Schema({})
);

module.exports = {
  User,
  HotelUser,
  PoliceUser,
  RegionalAdminUser,
};