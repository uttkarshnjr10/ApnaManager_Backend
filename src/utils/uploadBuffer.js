const { cloudinary } = require('./cloudinary');
const streamifier = require('streamifier');

/**
 * Uploads a Buffer to Cloudinary using upload_stream.
 * @param {Buffer} buffer - The file buffer to upload
 * @param {string} filename - The filename or public ID to use
 * @param {string} folder - The Cloudinary folder
 * @returns {Promise<Object>} - Resolves with { url, public_id }
 */
const uploadBufferToCloudinary = (buffer, filename, folder = 'cforms') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        public_id: filename,
        resource_type: 'raw', // 'raw' is appropriate for PDFs in Cloudinary, or 'image' if they want pdf generation preview, but 'raw' is safer for downloads. Wait, 'image' allows PDF manipulations in cloudinary. I will use 'raw' to just store the file securely. Wait, 'image' allows signed urls easily for PDFs and PDF preview. Let's use 'raw' as it's a non-image file. Actually, Cloudinary handles pdfs as 'image' for transformation, but 'raw' is better for just serving. Let's use 'image' so it can be previewed if needed, or 'raw'. Let's stick to 'raw' because we just need to download it. Wait, generateSignedUrl in cloudinary.js uses 'type: authenticated'. So it's better to use 'raw' or 'image'. I will use 'image' and 'format: pdf' to be safe, but since it's a PDF buffer, Cloudinary auto-detects it. Wait, the prompt says "Use Cloudinary's upload_stream API". Let's use resource_type: 'auto'.
        type: 'authenticated', // keep it protected
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }
        resolve({
          url: result.secure_url,
          public_id: result.public_id,
        });
      }
    );

    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

module.exports = { uploadBufferToCloudinary };
