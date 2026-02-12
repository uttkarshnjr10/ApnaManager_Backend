// src/config/redisClient.js
const redis = require('redis');
const logger = require('../utils/logger');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const client = redis.createClient({
  url: redisUrl,
  socket: {
    reconnectStrategy: (retries) => {
      // Wait 1s, then 2s, up to 3s, then keep trying every 3s
      if (retries > 10) {
        logger.error('Redis: Max retries exhausted. Is Redis running?');
        return new Error('Redis max retries reached');
      }
      return Math.min(retries * 1000, 3000);
    },
  },
});

client.on('error', (err) => {
  // suppress mundane connection errors during startup to keep logs clean
  if (err.code === 'ECONNREFUSED') {
    logger.error(`Redis connection failed at ${redisUrl}. Ensure Redis is running.`);
  } else {
    logger.error(`Redis Client Error: ${err.message}`);
  }
});

client.on('connect', () => {
  logger.info(`Redis client connected to ${redisUrl}`);
});

const connectRedis = async () => {
  try {
    await client.connect();
  } catch (err) {
    logger.error(`Failed to connect to Redis initially: ${err.message}`);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
};

module.exports = { client, connectRedis };
