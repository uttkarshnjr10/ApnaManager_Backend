const mongoose = require('mongoose');

const watchlistSchema = new mongoose.Schema({
    value: {
        type: String,
        required: true,
        trim: true,
        unique: true, 
    },
    type: {
        type: String,
        enum: ['ID_Number', 'Phone_Number'],
        required: true,
    },
    reason: {
        type: String,
        required: [true, 'A reason for watchlisting is required.'],
        trim: true,
    },
    // This links to the Admin who added the item, for accountability
    addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        refPath: 'addedByModel'
    },
    addedByModel: {
        type: String,
        required: true,
        enum: ['Police', 'RegionalAdmin']
    },
}, {
    timestamps: true,
});

const Watchlist = mongoose.model('Watchlist', watchlistSchema);
module.exports = Watchlist;