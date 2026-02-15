const dotenv = require('dotenv');
const http = require('http'); // Required for stable Socket.io

dotenv.config();

const connectDB = require('./src/config/db');
const { connectRedis } = require('./src/config/redisClient');
const logger = require('./src/utils/logger');
const { initSocket } = require('./src/config/socket');

const app = require('./src/app');

connectDB();
connectRedis();

const PORT = process.env.PORT || 5000;

// Create explicit HTTP server for better Socket.io binding
const server = http.createServer(app);

// initialize Socket.io (Bind to the new HTTP server)
initSocket(server);

// start Server
server.listen(PORT, () => {
  logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  logger.info(`Memory limit: ${process.env.MAX_OLD_SPACE_SIZE || '512'}MB`);
});

// Graceful Shutdown for Render Restarts
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

// handle Crashes
process.on('unhandledRejection', (err, promise) => {
  logger.error(`Unhandled Rejection: ${err.message}`);
  // Don't kill the server immediately in production on free tier, just log it
  if (process.env.NODE_ENV !== 'production') {
    server.close(() => process.exit(1));
  }
});
