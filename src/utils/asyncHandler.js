/**
 * Wraps async route handlers to catch errors automatically.
 * Eliminates the need for try-catch blocks in controllers.
 * * @param {Function} requestHandler - The async function to execute
 */
const asyncHandler = (requestHandler) => {
  return (req, res, next) => {
    Promise.resolve(requestHandler(req, res, next)).catch((err) => next(err));
  };
};

module.exports = asyncHandler;
