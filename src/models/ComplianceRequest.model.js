const mongoose = require('mongoose');

const complianceRequestSchema = new mongoose.Schema({
  requestReference: { 
    type: String, 
    required: true, 
    unique: true 
  },
  requestingAuthority: { 
    type: String, 
    required: true 
  },
  authorityContactName: { 
    type: String 
  },
  authorityContactPhone: { 
    type: String 
  },
  requestDate: { 
    type: Date, 
    required: true 
  },
  legalBasis: { 
    type: String, 
    required: true,
    enum: [
      'Court Order', 
      'FIR Reference', 
      'Missing Person Report', 
      'Official Letter',
      'Search Warrant', 
      'Other'
    ]
  },
  caseReferenceNumber: { 
    type: String 
  },
  dataRequested: { 
    type: String, 
    required: true 
  },
  guestsExported: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Guest' 
  }],
  exportPdfUrl: { 
    type: String 
  },
  exportPdfPublicId: { 
    type: String 
  },
  status: {
    type: String,
    enum: ['Logged', 'In Review', 'Fulfilled', 'Rejected'],
    default: 'Logged'
  },
  adminNotes: { 
    type: String 
  },
  fulfilledAt: { 
    type: Date 
  },
  fulfilledBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'RegionalAdmin' 
  },
  rejectionReason: { 
    type: String 
  }
}, { timestamps: true });

const ComplianceRequest = mongoose.model('ComplianceRequest', complianceRequestSchema);
module.exports = ComplianceRequest;
