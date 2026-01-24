const express = require('express');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
dotenv.config();

const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const connectDB = require('./src/config/db');
const { connectRedis } = require('./src/config/redisClient');
const logger = require('./src/utils/logger');
const { notFound, errorHandler } = require('./src/middleware/error.middleware');
const mainRouter = require('./src/routes/index'); 

// SOCKET INIT
const { initSocket } = require('./src/config/socket'); 

connectDB();
connectRedis();

const app = express();

const allowedOrigins = 
          process.env.CORS_ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:5173'];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log("BLOCKED CORS ORIGIN:", origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, 
};

app.use(cors(corsOptions));
app.use(helmet());
app.use(express.json());
app.use(cookieParser());

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

app.use('/api', mainRouter); 

app.get('/', (req, res) => res.send('Server is running...'));

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// Capture the HTTP Server instance
const server = app.listen(PORT, () => {
  logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

// Initialize Socket.io with that server
initSocket(server);

process.on('unhandledRejection', (err, promise) => {
  logger.error(`Unhandled Rejection: ${err.message}`);
  server.close(() => process.exit(1));
});