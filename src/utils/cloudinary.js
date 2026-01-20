const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');
const sharp = require('sharp'); 
const logger = require('./logger'); // Assuming you have a logger, or use console

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadToCloudinary = (file, folder = 'guest-guard') => {
    return new Promise(async (resolve, reject) => {
        try {
            // STEP 1: Process Image in Memory (Buffer Strategy)
            // This is safer on Windows than Stream Pipelining
            let processedBuffer;
            
            try {
                processedBuffer = await sharp(file.buffer)
                    .resize(1280, 1280, { 
                        fit: 'inside', 
                        withoutEnlargement: true 
                    })
                    .toFormat('webp', { quality: 80 })
                    // We REMOVED .strip() temporarily to see if that was the specific crasher.
                    // .toFormat() usually resets metadata anyway.
                    .toBuffer();
            } catch (sharpError) {
                console.error("❌ Sharp Processing Failed:", sharpError);
                return reject(new Error(`Image processing failed: ${sharpError.message}`));
            }

            // STEP 2: Upload Processed Buffer to Cloudinary
            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    folder: folder,
                    resource_type: 'image',
                    type: 'authenticated', // Secure access
                },
                (error, result) => {
                    if (error) {
                        console.error("❌ Cloudinary Upload Failed:", error);
                        return reject(error);
                    }
                    resolve({
                        public_id: result.public_id,
                        url: result.secure_url,
                        fieldname: file.fieldname 
                    });
                }
            );

            // Turn the processed buffer back into a stream for Cloudinary
            streamifier.createReadStream(processedBuffer).pipe(uploadStream);

        } catch (error) {
            reject(error);
        }
    });
};

const generateSignedUrl = (publicId) => {
    if (!publicId) return null;
    return cloudinary.url(publicId, {
        secure: true,
        type: 'authenticated',
        sign_url: true,
        expires_at: Math.floor(Date.now() / 1000) + 3600 // 1 hour
    });
};

module.exports = { cloudinary, uploadToCloudinary, generateSignedUrl };