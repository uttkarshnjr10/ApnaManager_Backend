const dotenv = require('dotenv');

dotenv.config();

const connectDB = require('./src/config/db');
const { connectRedis } = require('./src/config/redisClient');
const logger = require('./src/utils/logger');
const { initSocket } = require('./src/config/socket'); 

const app = require('./src/app');

connectDB();
connectRedis();

const PORT = process.env.PORT || 5000;

// start Server
const server = app.listen(PORT, () => {
  logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

// initialize Socket.io
initSocket(server);

// handle Crashes
process.on('unhandledRejection', (err, promise) => {
  logger.error(`Unhandled Rejection: ${err.message}`);
  server.close(() => process.exit(1));
});