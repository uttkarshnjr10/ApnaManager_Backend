// src/utils/logger.js
const { createLogger, format, transports } = require('winston');
const path = require('path');

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

// ─── Custom Formats ────────────────────────────────────────────

/**
 * Production format: structured JSON for log aggregators (Datadog, ELK, etc.)
 * Example: {"level":"info","message":"Server started","timestamp":"2026-04-11T18:30:00.000Z","service":"apna-register"}
 */
const productionFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.errors({ stack: true }),
  format.json()
);

/**
 * Development format: colorized, human-readable console output.
 * Example: 2026-04-11 18:30:00 [info]: Server started on port 5000
 */
const developmentFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.errors({ stack: true }),
  format.colorize({ all: true }),
  format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    if (stack) log += `\n${stack}`;
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    return log;
  })
);

// ─── Transport Configuration ───────────────────────────────────

const logTransports = [];

// Console transport (always active, except in test where it's silent)
logTransports.push(
  new transports.Console({
    silent: isTest,
  })
);

// File transports (production only — write structured logs to disk)
if (isProduction) {
  const logDir = process.env.LOG_DIR || 'logs';

  // All logs (info and above)
  logTransports.push(
    new transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5 * 1024 * 1024, // 5MB per file
      maxFiles: 5, // Keep last 5 rotated files
      tailable: true,
    })
  );

  // Error logs only
  logTransports.push(
    new transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    })
  );
}

// ─── Logger Instance ───────────────────────────────────────────

const logger = createLogger({
  level: isProduction ? 'info' : 'debug',
  format: isProduction ? productionFormat : developmentFormat,
  defaultMeta: { service: 'apna-register' },
  transports: logTransports,
  // Prevent unhandled rejections from crashing the process
  exitOnError: false,
});

// ─── Uncaught Exception / Rejection Handlers ──────────────────

if (isProduction) {
  logger.exceptions.handle(
    new transports.File({ filename: path.join(process.env.LOG_DIR || 'logs', 'exceptions.log') })
  );
  logger.rejections.handle(
    new transports.File({ filename: path.join(process.env.LOG_DIR || 'logs', 'rejections.log') })
  );
}

module.exports = logger;
