const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
  try {
    const connOptions = {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      //Connection pool limits to save RAM on Render Free Tier
      maxPoolSize: 10, // Max 10 active connections at once
      minPoolSize: 2, // Keep 2 idle connections ready to go
    };

    const conn = await mongoose.connect(process.env.MONGO_URI, connOptions);
    logger.info(`MongoDB Connected: ${conn.connection.host} `);

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected!');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected!');
    });
  } catch (error) {
    logger.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
