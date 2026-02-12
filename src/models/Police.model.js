const mongoose = require('mongoose');
const {
  baseAuthFields,
  preSaveHashPassword,
  matchPasswordMethod,
  createPasswordResetTokenMethod,
} = require('./schemas/baseAuth.schema');

const policeSchema = new mongoose.Schema(
  {
    ...baseAuthFields,

    // Police Specific Fields
    jurisdiction: { type: String, trim: true },
    serviceId: { type: String, trim: true },
    rank: { type: String, trim: true },
    station: { type: String, trim: true },
    policeStation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PoliceStation',
      required: true,
    },
  },
  { timestamps: true }
);

policeSchema.pre('save', preSaveHashPassword);
policeSchema.methods.matchPassword = matchPasswordMethod;
policeSchema.methods.createPasswordResetToken = createPasswordResetTokenMethod;

const Police = mongoose.model('Police', policeSchema);
module.exports = Police;
