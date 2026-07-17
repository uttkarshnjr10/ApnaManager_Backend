const mongoose = require('mongoose');
const {
  baseAuthFields,
  preSaveHashPassword,
  matchPasswordMethod,
  createPasswordResetTokenMethod,
} = require('./schemas/base-auth.schema');

const regionalAdminSchema = new mongoose.Schema(
  {
    ...baseAuthFields,
    // TOTP fields
    totpSecret: {
      type: String,
      select: false,
    },
    totpEnabled: {
      type: Boolean,
      default: false,
    },
    totpVerifiedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

regionalAdminSchema.pre('save', preSaveHashPassword);
regionalAdminSchema.methods.matchPassword = matchPasswordMethod;
regionalAdminSchema.methods.createPasswordResetToken = createPasswordResetTokenMethod;

const RegionalAdmin = mongoose.model('RegionalAdmin', regionalAdminSchema);
module.exports = RegionalAdmin;
