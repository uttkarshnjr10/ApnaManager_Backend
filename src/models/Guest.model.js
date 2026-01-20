const mongoose = require('mongoose');
const { randomBytes } = require('crypto');

// Reusable Image Schema (Url + Public ID)
const imageSchema = {
    url: { type: String, required: true },
    public_id: { type: String, required: true } 
};

// Optional Image Schema (for guests who might not have some photos)
const optionalImageSchema = {
    url: { type: String },
    public_id: { type: String }
};

const individualGuestSchema = new mongoose.Schema({
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
}, { _id: false });

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
    
    // UPDATED: Now storing Objects instead of just Strings
    idImageFront: imageSchema, 
    idImageBack: imageSchema,
    livePhoto: imageSchema,

    accompanyingGuests: {
        adults: [{
            name: { type: String, required: true, trim: true },
            dob: { type: Date, required: true },
            gender: { type: String, required: true, enum: ['Male', 'Female', 'Other'] },
            livePhoto: optionalImageSchema, // Updated
            idType: { type: String },
            idNumber: { type: String, trim: true },
            idImageFront: optionalImageSchema, // Updated
            idImageBack: optionalImageSchema, // Updated
            _id: false
        }],
        children: [{
            name: { type: String, required: true, trim: true },
            dob: { type: Date, required: true },
            gender: { type: String, required: true, enum: ['Male', 'Female', 'Other'] },
            livePhoto: optionalImageSchema, // Updated
            idType: { type: String },
            idNumber: { type: String, trim: true },
            idImageFront: optionalImageSchema, // Updated
            idImageBack: optionalImageSchema, // Updated
            _id: false
        }]
    },
    stayDetails: {
        purposeOfVisit: { type: String, required: true, trim: true },
        checkIn: { type: Date, default: Date.now },
        expectedCheckout: { type: Date, required: true },
        roomNumber: { type: String, trim: true },
    },
    hotel: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
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

guestSchema.pre('validate', function(next) {
    if (this.isNew) {
        this.customerId = `G-${randomBytes(3).toString('hex').toUpperCase()}`;
    }
    next();
});

const Guest = mongoose.model('Guest', guestSchema);
module.exports = Guest;


// const mongoose = require('mongoose');
// const { randomBytes } = require('crypto');

// // schema for indiviual guest
// const individualGuestSchema = new mongoose.Schema({
//     name: { type: String, required: true, trim: true },
//     dob: { type: Date, required: true },
//     gender: { type: String, required: true, enum: ['Male', 'Female', 'Other'] },
//     phone: { type: String, required: true, trim: true },
//     email: { type: String, required: true, trim: true, lowercase: true },
//     address: {
//         street: { type: String, trim: true },
//         city: { type: String, required: true, trim: true },
//         state: { type: String, trim: true },
//         zipCode: { type: String, trim: true },
//     },
// }, { _id: false });

// // Main guest schema
// const guestSchema = new mongoose.Schema({
//     customerId: {
//         type: String,
//         unique: true,
//         required: true,
//     },
//     primaryGuest: {
//         type: individualGuestSchema,
//         required: true,
//     },
//     idType: { type: String, required: true },
//     idNumber: { type: String, required: true, trim: true },
//     idImageFrontURL: { type: String, required: true },
//     idImageBackURL: { type: String, required: true },
//     livePhotoURL: { type: String, required: true },
//     accompanyingGuests: {
//         adults: [{
//             name: { type: String, required: true, trim: true },
//             dob: { type: Date, required: true },
//             gender: { type: String, required: true, enum: ['Male', 'Female', 'Other'] },
//             livePhotoURL: { type: String },
//             idType: { type: String },
//             idNumber: { type: String, trim: true },
//             idImageFrontURL: { type: String },
//             idImageBackURL: { type: String },
//             _id: false
//         }],
//         children: [{
//             name: { type: String, required: true, trim: true },
//             dob: { type: Date, required: true },
//             gender: { type: String, required: true, enum: ['Male', 'Female', 'Other'] },
//             livePhotoURL: { type: String },
//             idType: { type: String },
//             idNumber: { type: String, trim: true },
//             idImageFrontURL: { type: String },
//             idImageBackURL: { type: String },
//             _id: false
//         }]
//     },
//     stayDetails: {
//         purposeOfVisit: { type: String, required: true, trim: true },
//         checkIn: { type: Date, default: Date.now },
//         expectedCheckout: { type: Date, required: true },
//         roomNumber: { type: String, trim: true },
//     },
//     hotel: {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: 'User',
//         required: true,
//     },
//     status: {
//         type: String,
//         enum: ['Checked-In', 'Checked-Out'],
//         default: 'Checked-In',
//     },
//     registrationTimestamp: {
//         type: Date,
//         default: Date.now,
//     },
// });

// guestSchema.pre('validate', function(next) {
//     if (this.isNew) {
//         this.customerId = `G-${randomBytes(3).toString('hex').toUpperCase()}`;
//     }
//     next();
// });

// const Guest = mongoose.model('Guest', guestSchema);
// module.exports = Guest;    