const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const Police = require('../models/Police.model');

let io;

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ALLOWED_ORIGINS?.split(',') || [
        'http://localhost:5173',
        'http://localhost:3000',
      ],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    // Heartbeat: detect dead connections early
    pingInterval: 25000,
    pingTimeout: 10000,
  });

  // ── Auth Middleware ─────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      let token = socket.handshake.auth.token;

      // Fallback: extract JWT from cookie header
      if (!token && socket.handshake.headers.cookie) {
        const match = socket.handshake.headers.cookie.match(/(?:^|;\s*)jwt=([^;]+)/);
        if (match) {
          token = match[1];
        }
      }

      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = { id: decoded.id, role: decoded.role };
      next();
    } catch (err) {
      logger.error(`Socket auth failed: ${err.message}`);
      next(new Error('Authentication error: Invalid token'));
    }
  });

  // ── Connection Handler ─────────────────────────────────────
  io.on('connection', async (socket) => {
    logger.info(`Socket connected: ${socket.id} (Role: ${socket.user.role})`);

    // Every authenticated user joins a personal room for targeted notifications
    socket.join(`user_${socket.user.id}`);

    // Police Officers join their Station's room
    if (socket.user.role === 'Police') {
      try {
        const officer = await Police.findById(socket.user.id).select('policeStation').lean();
        if (officer?.policeStation) {
          socket.join(`station_${officer.policeStation.toString()}`);
        }
      } catch (error) {
        logger.error(`Socket room join error: ${error.message}`);
      }
    }

    // Regional Admins join the global admin room
    if (socket.user.role === 'Regional Admin') {
      socket.join('admin_global');
    }

    // Hotel users join a hotel-specific room for real-time notifications
    if (socket.user.role === 'Hotel') {
      socket.join(`hotel_${socket.user.id}`);
    }

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized!');
  }
  return io;
};

module.exports = { initSocket, getIO };
