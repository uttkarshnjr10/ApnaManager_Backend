const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load env vars
dotenv.config();

// Connect to Test DB
const connectTestDB = async () => {
  try {
    const dbUri = process.env.MONGO_URI_TEST || 'mongodb://localhost:27017/apnamanager_test';
    await mongoose.connect(dbUri);
  } catch (error) {
    console.error('Test DB Connection Failed', error);
    process.exit(1);
  }
};

// Clear all collections
const clearTestDB = async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany();
  }
};

const closeTestDB = async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
};

module.exports = { connectTestDB, clearTestDB, closeTestDB };