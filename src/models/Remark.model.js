// models/Remark.model.js
const mongoose = require('mongoose');

const remarkSchema = new mongoose.Schema({
    guest: { type: mongoose.Schema.Types.ObjectId, ref: 'Guest', required: true },
    
    officer: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        refPath: 'officerModel' 
    },
    officerModel: {
        type: String,
        required: true,
        enum: ['Police', 'RegionalAdmin'] // Usually only Police/Admin make remarks?
    },
    
    text: { type: String, required: true, trim: true },
}, { timestamps: true });

const Remark = mongoose.model('Remark', remarkSchema);

module.exports = Remark;