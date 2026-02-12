// tests/setup.js
process.env.NODE_ENV = 'test';

// --- 1. Fake Keys for External Services (Fixes Stripe/Gemini crashes) ---
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake_stripe_key'; // Fixes Stripe Crash
process.env.GEMINI_API_KEY = 'test_gemini_key'; // Fixes Gemini Crash
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';
process.env.SENDGRID_API_KEY = 'SG.test-sendgrid-key'; // Fixes SendGrid Crash
process.env.SENDGRID_FROM_EMAIL = 'test@example.com';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';

// --- 2. Global Timeout ---
jest.setTimeout(10000);

// --- 3. Mock Logger (Fixes the logger error if you have one) ---
// If you don't have src/utils/logger.js, DELETE these lines
try {
  jest.mock(
    '../src/utils/logger',
    () => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
    { virtual: true }
  ); // 'virtual: true' allows mocking even if file doesn't exist
} catch (e) {
  console.log(`error ${e}`);
}
