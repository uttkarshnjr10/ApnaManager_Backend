// jest.config.js
module.exports = {
  testEnvironment: 'node',
  // This line tells Jest to load .env before running any test file
  setupFiles: ['dotenv/config'], 
  verbose: true,
  forceExit: true, // Forces Jest to exit after tests complete (fixes open handles)
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
};