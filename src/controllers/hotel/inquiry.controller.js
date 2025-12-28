const HotelInquiry = require('../../models/HotelInquiry.model');
const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/ApiError');
const ApiResponse = require('../../utils/ApiResponse');

const submitHotelInquiry = asyncHandler(async (req, res) => {
    if (!req.files || !req.files.ownerSignature || !req.files.hotelStamp) {
        throw new ApiError(400, "signature and stamp files are required");
    }

    const newInquiry = new HotelInquiry({
        ...req.body,
        ownerSignature: {
            public_id: req.files.ownerSignature[0].filename,
            url: req.files.ownerSignature[0].path
        },
        hotelStamp: {
            public_id: req.files.hotelStamp[0].filename,
            url: req.files.hotelStamp[0].path
        },

    });
    
    if (req.files.aadhaarCard && req.files.aadhaarCard.length > 0) {
        newInquiryData.aadhaarCard = {
            public_id: req.files.aadhaarCard[0].filename,
            url: req.files.aadhaarCard[0].path
        };
    }

    await newInquiry.save();
    res
    .status(201)
    .json(new ApiResponse(201, newInquiry, 'hotel registration request submitted successfully'));
});

const getPendingInquiries = asyncHandler(async (req, res) => {
    const inquiries = await HotelInquiry.find({ status: 'pending' }).sort({ createdAt: -1 });
    res
    .status(200)
    .json(new ApiResponse(200, inquiries));
});

const updateInquiryStatus = asyncHandler(async (req, res) => {
    const { status } = req.body; 
    if (!['approved', 'rejected'].includes(status)) {
        throw new ApiError(400, 'invalid status provided');
    }

    const inquiry = await HotelInquiry.findByIdAndUpdate(
        req.params.id,
        { status },
        { new: true }
    );

    if (!inquiry) {
        throw new ApiError(404, 'inquiry not found');
    }
    
    const message = `inquiry ${status} successfully`;
    res
    .status(200)
    .json(new ApiResponse(200, inquiry, message));
});


module.exports = {
    submitHotelInquiry,
    getPendingInquiries,
    updateInquiryStatus,
}