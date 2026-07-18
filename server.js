// server.js — Application Entry Point
const dotenv = require('dotenv');
const http = require('http');

// Load environment variables (before anything else)
dotenv.config();

// Set default NODE_ENV if not set
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const connectDB = require('./src/config/db');
const { connectRedis } = require('./src/config/redis');
const logger = require('./src/utils/logger');
const { initSocket } = require('./src/config/socket');
const app = require('./src/app');

// ── Bootstrap ──────────────────────────────────────────────────

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // 1. Connect to MongoDB
    await connectDB();
    const { startScheduledJobs } = require('./src/utils/scheduler');
    startScheduledJobs();

    // 2. Connect to Redis (non-blocking — app works without it)
    try {
      await connectRedis();
    } catch (redisErr) {
      logger.warn(`Redis connection failed: ${redisErr.message}. Token blacklisting disabled.`);
    }

    // 3. Create HTTP server and bind Socket.io
    const server = http.createServer(app);
    initSocket(server);

    // 4. Start listening
    server.listen(PORT, () => {
      logger.info(`🚀 ApnaManager server started successfully`);
      logger.info(`   Environment : ${process.env.NODE_ENV}`);
      logger.info(`   Port        : ${PORT}`);
      logger.info(`   Process ID  : ${process.pid}`);
    });

    // ── Graceful Shutdown ────────────────────────────────────

    const gracefulShutdown = (signal) => {
      logger.info(`${signal} received — shutting down gracefully...`);
      server.close(() => {
        logger.info('HTTP server closed. Exiting.');
        process.exit(0);
      });

      // Force kill after 10s if graceful shutdown stalls
      setTimeout(() => {
        logger.error('Graceful shutdown timed out. Forcing exit.');
        process.exit(1);
      }, 10_000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // ── Crash Handlers ───────────────────────────────────────

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled Rejection:', reason);
      // In development, crash fast so the error is visible
      if (process.env.NODE_ENV !== 'production') {
        server.close(() => process.exit(1));
      }
    });

    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception:', err);
      // Always exit on uncaught exceptions — state is unreliable
      server.close(() => process.exit(1));
    });
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
};

startServer();
