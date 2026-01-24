const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const baseAuthOptions = {
    discriminatorKey: 'kind', // Not used for inheritance anymore, just metadata
    _id: false, // We will merge this into the main schema
};

// Define the fields common to ALL users
const baseAuthFields = {
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
};

// Reusable middleware for Hashing Password
const preSaveHashPassword = async function (next) {
    if (!this.isModified('password')) return next();
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
};

// Reusable method for Checking Password
const matchPasswordMethod = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

// Reusable method for Reset Token
const createPasswordResetTokenMethod = function () {
    const resetToken = crypto.randomBytes(32).toString('hex');
    this.passwordResetToken = crypto
        .createHash('sha256')
        .update(resetToken)
        .digest('hex');
    this.passwordResetExpires = Date.now() + 10 * 60 * 1000;
    return resetToken;
};

module.exports = {
    baseAuthFields,
    preSaveHashPassword,
    matchPasswordMethod,
    createPasswordResetTokenMethod
};