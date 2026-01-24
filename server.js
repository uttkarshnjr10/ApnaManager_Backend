// server.js
const dotenv = require('dotenv');
// 1. Load Env Vars FIRST
dotenv.config();

const connectDB = require('./src/config/db');
const { connectRedis } = require('./src/config/redisClient');
const logger = require('./src/utils/logger');
const { initSocket } = require('./src/config/socket'); 

// 2. Import the configured App
const app = require('./src/app');

// 3. Connect to Databases
connectDB();
connectRedis();

const PORT = process.env.PORT || 5000;

// 4. Start Server
const server = app.listen(PORT, () => {
  logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

// 5. Initialize Socket.io
initSocket(server);

// 6. Handle Crashes
process.on('unhandledRejection', (err, promise) => {
  logger.error(`Unhandled Rejection: ${err.message}`);
  server.close(() => process.exit(1));
});