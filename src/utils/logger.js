const getTimestamp = () => new Date().toLocaleTimeString();

const info = (message) => {
  console.log(`[info] ${getTimestamp()}: ${message}`);
};

const warn = (message) => {
  console.warn(`[warn] ${getTimestamp()}: ${message}`);
};

const error = (message) => {
  console.error(`[error] ${getTimestamp()}: ${message}`);
};

module.exports = {
  info,
  warn,
  error,
};

/*
const colors = {
  info: '\x1b[36m', // Cyan
  warn: '\x1b[33m', // Yellow
  error: '\x1b[31m', // Red
  reset: '\x1b[0m', // Reset color
};
*/
