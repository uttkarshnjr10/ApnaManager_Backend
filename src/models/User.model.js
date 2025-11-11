const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const options = {
  timestamps: true,
  discriminatorKey: 'role', 
};

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
      select: false, // hide password from queries by default
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
  options // Pass options here
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
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000;
  return resetToken;
};

//used for authentication (login, protect middleware)
const User = mongoose.model('User', baseUserSchema);

// 'Hotel' Discriminator
// It inherits everything from baseUserSchema and adds these fields:
const HotelUser = User.discriminator(
  'Hotel',
  new mongoose.Schema({
    hotelName: { type: String, trim: true, required: true },
    city: { type: String, trim: true, required: true },
    address: { type: String, trim: true },
    phone: { type: String, trim: true },
  })
);

//  'Police' Discriminator
// It inherits everything from baseUserSchema and adds these fields:
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
// It inherits from baseUserSchema but adds no extra fields.
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