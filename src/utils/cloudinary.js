// src/utils/cloudinary.js
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Uploads a file buffer to Cloudinary using streams.
 * This is required for the parallel upload optimization.
 */
const uploadToCloudinary = (file, folder = 'guest-guard') => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: folder,
                resource_type: 'auto',
            },
            (error, result) => {
                if (error) return reject(error);
                resolve({
                    public_id: result.public_id,
                    url: result.secure_url,
                    fieldname: file.fieldname 
                });
            }
        );
        streamifier.createReadStream(file.buffer).pipe(uploadStream);
    });
};

module.exports = { cloudinary, uploadToCloudinary };