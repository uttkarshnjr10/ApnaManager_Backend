// src/app.js
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { notFound, errorHandler } = require('./middleware/error.middleware');
const mainRouter = require('./routes/index'); 

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

// Middleware
app.use(cors(corsOptions));
app.use(helmet());
app.use(express.json());
app.use(cookieParser());

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Routes
app.use('/api', mainRouter); 
app.get('/', (req, res) => res.send('Server is running...'));

// Error Handlers
app.use(notFound);
app.use(errorHandler);

// Export the configured app
module.exports = app;