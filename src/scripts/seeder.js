// seeder.js
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const logger = require('../utils/logger');

// 1. FIX: Import the specific RegionalAdmin model
const RegionalAdmin = require('../models/RegionalAdmin.model');

dotenv.config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    logger.info('MongoDB connected for seeding...');
  } catch (err) {
    logger.error(`Error connecting to DB for seeding: ${err.message}`);
    process.exit(1);
  }
};

const importData = async () => {
  try {
    // 2. Clear only the Admin collection
    await RegionalAdmin.deleteMany();

    const adminUser = {
      username: process.env.ADMIN_USERNAME || 'admin',
      email: process.env.ADMIN_EMAIL || 'admin@example.com',
      password: process.env.ADMIN_PASSWORD || 'password123',
      // We don't need to save "role: 'Regional Admin'" in the DB anymore.
      // The fact that this document exists in the "regionaladmins" collection
      // IS the proof of their role.
      passwordChangeRequired: false,
    };

    // 3. Create (triggers pre-save hook for password hashing)
    await RegionalAdmin.create(adminUser);

    logger.info('Regional Admin user has been successfully created!');
    process.exit();
  } catch (error) {
    logger.error(`Error during seeding: ${error.message}`);
    process.exit(1);
  }
};

connectDB().then(() => {
  importData();
});
