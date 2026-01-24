const mongoose = require('mongoose');
const { 
    baseAuthFields, 
    preSaveHashPassword, 
    matchPasswordMethod, 
    createPasswordResetTokenMethod 
} = require('./schemas/baseAuth.schema');

const regionalAdminSchema = new mongoose.Schema({
    ...baseAuthFields,
    // Add specific admin fields here if needed in future
}, { timestamps: true });

regionalAdminSchema.pre('save', preSaveHashPassword);
regionalAdminSchema.methods.matchPassword = matchPasswordMethod;
regionalAdminSchema.methods.createPasswordResetToken = createPasswordResetTokenMethod;

const RegionalAdmin = mongoose.model('RegionalAdmin', regionalAdminSchema);
module.exports = RegionalAdmin;