const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    recipientStation: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PoliceStation',
        // Not required if the notification is for a Regional Admin who has no station
        required: false, 
    },
    
    // DYNAMIC REFERENCE
    recipientUser: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        refPath: 'recipientModel' // Tells Mongoose which collection to join
    },
    recipientModel: {
        type: String,
        required: true,
        enum: ['Police', 'RegionalAdmin', 'Hotel'] 
    },
    
    message: {
        type: String,
        required: true,
    },
    isRead: {
        type: Boolean,
        default: false,
    },
}, { timestamps: true });

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;