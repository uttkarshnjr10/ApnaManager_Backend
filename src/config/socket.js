const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const Police = require('../models/Police.model');
const cookie = require('cookie'); // Optional, but regex is fine if you don't want to install it.

let io;

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ALLOWED_ORIGINS?.split(',') || [
        'http://localhost:5173',
        'http://localhost:3000',
      ],
      methods: ['GET', 'POST'],
      credentials: true, // Allow cookies to pass through
    },
  });

  // Middleware: Authenticate Socket Connections
  io.use(async (socket, next) => {
    try {
      let token = socket.handshake.auth.token;

      // 1. NEW LOGIC: If no auth token sent manually, check the cookies
      if (!token && socket.handshake.headers.cookie) {
        // Simple regex to grab the 'jwt' cookie
        const match = socket.handshake.headers.cookie.match(/(^| )jwt=([^;]+)/);
        if (match) {
          token = match[2];
        }
      }

      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      socket.user = {
        id: decoded.id,
        role: decoded.role,
      };

      next();
    } catch (err) {
      //console.log("Socket Auth Failed:", err.message);
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    //logger.info(`🔌 Socket Connected: ${socket.id} (Role: ${socket.user.role})`);

    // 1. Police Officers join their Station's Room
    if (socket.user.role === 'Police') {
      try {
        const officer = await Police.findById(socket.user.id).select('policeStation');
        if (officer && officer.policeStation) {
          const roomName = `station_${officer.policeStation.toString()}`;
          socket.join(roomName);
          // logger.info(`👮 Officer ${socket.user.id} joined channel: ${roomName}`);
        }
      } catch (error) {
        //  logger.error(`Socket Room Error: ${error.message}`);
      }
    }

    // 2. Admins join the Global Admin Room
    if (socket.user.role === 'Regional Admin') {
      socket.join('admin_global');
      //  logger.info(`👨‍💼 Admin ${socket.user.id} joined channel: admin_global`);
    }

    socket.on('disconnect', () => {
      // logger.info(`Socket Disconnected: ${socket.id}`);
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
