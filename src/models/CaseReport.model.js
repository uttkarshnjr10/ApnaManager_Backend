const mongoose = require('mongoose');

const caseReportSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    summary: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['Open', 'Under Investigation', 'Closed'],
      default: 'Open',
    },
    // Link to the officer who filed it
    officer: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'officerModel',
    },
    officerModel: {
      type: String,
      required: true,
      enum: ['Police'], // Only police file cases?
    },

    guest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Guest',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const CaseReport = mongoose.model('CaseReport', caseReportSchema);
module.exports = CaseReport;
