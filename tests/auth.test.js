// tests/auth.test.js
const request = require('supertest');
const mongoose = require('mongoose');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Models
const Hotel = require('../src/models/Hotel.model');
const Police = require('../src/models/Police.model');
const RegionalAdmin = require('../src/models/RegionalAdmin.model');

// Test DB helpers
const { connectTestDB, closeTestDB, clearTestDB } = require('./testDb');

// Routes
const authRoutes = require('../src/routes/auth.routes');

// Mock external services
jest.mock('../src/utils/sendEmail');
jest.mock('../src/config/redisClient', () => ({
  client: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

const { sendPasswordResetEmail } = require('../src/utils/sendEmail');
const { client: redisClient } = require('../src/config/redisClient');

describe('Authentication API Tests', () => {
  let app;

  beforeAll(async () => {
    await connectTestDB();

    // Create Express app
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/auth', authRoutes);

    // Error handler
    app.use((err, req, res, next) => {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message,
      });
    });
  });

  afterEach(async () => {
    await clearTestDB();
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  describe('POST /api/auth/login - Login User', () => {
    let testHotel;

    beforeEach(async () => {
      // Create test hotel user
      testHotel = await Hotel.create({
        username: 'testhotel',
        email: 'hotel@test.com',
        password: 'password123',
        hotelName: 'Test Hotel',
        city: 'Mumbai',
        state: 'Maharashtra',
        pinCode: '400001',
        passwordChangeRequired: false,
        status: 'Active',
      });

      // Mock Redis
      redisClient.get.mockResolvedValue(null);
    });

    test('SUCCESS: Should login with valid credentials', async () => {
      const response = await request(app).post('/api/auth/login').send({
        email: 'hotel@test.com',
        password: 'password123',
        loginType: 'Hotel',
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Login successful');
      expect(response.body.data).toHaveProperty('token');
      expect(response.body.data).toHaveProperty('_id');
      expect(response.body.data.email).toBe('hotel@test.com');
      expect(response.body.data.role).toBe('Hotel');
      expect(response.headers['set-cookie']).toBeDefined();
    });

    test('SUCCESS: Should login without loginType hint', async () => {
      const response = await request(app).post('/api/auth/login').send({
        email: 'hotel@test.com',
        password: 'password123',
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('ERROR: Should fail with missing email', async () => {
      const response = await request(app).post('/api/auth/login').send({
        password: 'password123',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Email and password are required');
    });

    test('ERROR: Should fail with missing password', async () => {
      const response = await request(app).post('/api/auth/login').send({
        email: 'hotel@test.com',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Email and password are required');
    });

    test('ERROR: Should fail with invalid email', async () => {
      const response = await request(app).post('/api/auth/login').send({
        email: 'nonexistent@test.com',
        password: 'password123',
      });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid email or password');
    });

    test('ERROR: Should fail with wrong password', async () => {
      const response = await request(app).post('/api/auth/login').send({
        email: 'hotel@test.com',
        password: 'wrongpassword',
      });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid email or password');
    });

    test('ERROR: Should fail for suspended account', async () => {
      testHotel.status = 'Suspended';
      await testHotel.save();

      const response = await request(app).post('/api/auth/login').send({
        email: 'hotel@test.com',
        password: 'password123',
      });

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('suspended');
    });

    test('SPECIAL: Should return 202 when password change required', async () => {
      testHotel.passwordChangeRequired = true;
      await testHotel.save();

      const response = await request(app).post('/api/auth/login').send({
        email: 'hotel@test.com',
        password: 'password123',
      });

      expect(response.status).toBe(202);
      expect(response.body.message).toContain('Password change required');
      expect(response.body.data).toHaveProperty('userId');
      expect(response.body.data).toHaveProperty('role');
    });

    test('SUCCESS: Should login Police user', async () => {
      const policeStation = new mongoose.Types.ObjectId();
      const police = await Police.create({
        username: 'officer123',
        email: 'police@test.com',
        password: 'password123',
        rank: 'Inspector',
        policeStation,
        passwordChangeRequired: false,
      });

      const response = await request(app).post('/api/auth/login').send({
        email: 'police@test.com',
        password: 'password123',
        loginType: 'Police',
      });

      expect(response.status).toBe(200);
      expect(response.body.data.role).toBe('Police');
    });

    test('SUCCESS: Should login Regional Admin', async () => {
      const admin = await RegionalAdmin.create({
        username: 'admin123',
        email: 'admin@test.com',
        password: 'password123',
        passwordChangeRequired: false,
      });

      const response = await request(app).post('/api/auth/login').send({
        email: 'admin@test.com',
        password: 'password123',
        loginType: 'Regional Admin',
      });

      expect(response.status).toBe(200);
      expect(response.body.data.role).toBe('Regional Admin');
    });
  });

  describe('POST /api/auth/logout - Logout User', () => {
    let token;
    let user;

    // 🔧 FIX: Ensure user and token exist BEFORE every test in this block
    beforeEach(async () => {
      // Create user
      user = await Hotel.create({
        username: 'logouthotel',
        email: 'logout@test.com',
        password: 'password123',
        hotelName: 'Logout Hotel',
        city: 'Mumbai',
        state: 'Maharashtra',
        pinCode: '400001',
        status: 'Active',
      });

      // Generate Token
      token = jwt.sign(
        { id: user._id, role: 'Hotel' },
        process.env.JWT_SECRET || 'test-jwt-secret-key',
        { expiresIn: '1h' }
      );

      // Mock Redis set/del
      redisClient.set.mockResolvedValue('OK');
      redisClient.del.mockResolvedValue(1);
    });

    test('SUCCESS: Should logout with valid token', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('Logged out successfully');
      expect(response.headers['set-cookie']).toBeDefined();
    });

    test('SUCCESS: Should logout without token', async () => {
      const response = await request(app).post('/api/auth/logout');

      // 🔧 FIX: Logout is protected, so no token = 401 Unauthorized
      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Not authorized');
    });
  });

  describe('POST /api/auth/forgot-password - Forgot Password', () => {
    let testHotel;

    beforeEach(async () => {
      testHotel = await Hotel.create({
        username: 'testhotel',
        email: 'hotel@test.com',
        password: 'password123',
        hotelName: 'Test Hotel',
        city: 'Mumbai',
        state: 'Maharashtra',
        pinCode: '400001',
      });

      sendPasswordResetEmail.mockResolvedValue(true);
    });

    test('SUCCESS: Should send reset email for existing user', async () => {
      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'hotel@test.com' });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('reset link has been sent');
      expect(sendPasswordResetEmail).toHaveBeenCalledWith(
        'hotel@test.com',
        'testhotel',
        expect.any(String)
      );

      // Verify token was saved
      const updatedHotel = await Hotel.findById(testHotel._id);
      expect(updatedHotel.passwordResetToken).toBeDefined();
      expect(updatedHotel.passwordResetExpires).toBeDefined();
    });

    test('SUCCESS: Should return same message for non-existent email (security)', async () => {
      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'nonexistent@test.com' });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('reset link has been sent');
      expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    test('ERROR: Should fail without email', async () => {
      const response = await request(app).post('/api/auth/forgot-password').send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('provide an email');
    });

    test('ERROR: Should rollback on email failure', async () => {
      sendPasswordResetEmail.mockRejectedValue(new Error('Email service down'));

      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'hotel@test.com' });

      expect(response.status).toBe(500);
      expect(response.body.message).toContain('Failed to send');

      // Verify token was cleared
      const updatedHotel = await Hotel.findById(testHotel._id);
      expect(updatedHotel.passwordResetToken).toBeUndefined();
      expect(updatedHotel.passwordResetExpires).toBeUndefined();
    });
  });

  describe('POST /api/auth/reset-password - Reset Password', () => {
    let testHotel;
    let resetToken;

    beforeEach(async () => {
      testHotel = await Hotel.create({
        username: 'testhotel',
        email: 'hotel@test.com',
        password: 'oldpassword123',
        hotelName: 'Test Hotel',
        city: 'Mumbai',
        state: 'Maharashtra',
        pinCode: '400001',
      });

      // Generate reset token
      resetToken = testHotel.createPasswordResetToken();
      await testHotel.save();
    });

    test('SUCCESS: Should reset password with valid token', async () => {
      const response = await request(app).post('/api/auth/reset-password').send({
        token: resetToken,
        newPassword: 'newpassword123',
      });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('reset successfully');

      // Verify password was changed
      const updatedHotel = await Hotel.findById(testHotel._id).select('+password');
      const isMatch = await updatedHotel.matchPassword('newpassword123');
      expect(isMatch).toBe(true);

      // Verify reset token was cleared
      expect(updatedHotel.passwordResetToken).toBeUndefined();
      expect(updatedHotel.passwordResetExpires).toBeUndefined();
      expect(updatedHotel.passwordChangeRequired).toBe(false);
    });

    test('ERROR: Should fail without token', async () => {
      const response = await request(app).post('/api/auth/reset-password').send({
        newPassword: 'newpassword123',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('token and new password are required');
    });

    test('ERROR: Should fail without new password', async () => {
      const response = await request(app).post('/api/auth/reset-password').send({
        token: resetToken,
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('token and new password are required');
    });

    test('ERROR: Should fail with short password', async () => {
      const response = await request(app).post('/api/auth/reset-password').send({
        token: resetToken,
        newPassword: '12345',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('at least 6 characters');
    });

    test('ERROR: Should fail with invalid token', async () => {
      const response = await request(app).post('/api/auth/reset-password').send({
        token: 'invalidtoken123',
        newPassword: 'newpassword123',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('invalid or has expired');
    });

    test('ERROR: Should fail with expired token', async () => {
      // Manually expire token
      testHotel.passwordResetExpires = Date.now() - 1000;
      await testHotel.save();

      const response = await request(app).post('/api/auth/reset-password').send({
        token: resetToken,
        newPassword: 'newpassword123',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('invalid or has expired');
    });
  });

  describe('POST /api/auth/change-password - Force Change Password', () => {
    let testHotel;

    beforeEach(async () => {
      testHotel = await Hotel.create({
        username: 'testhotel',
        email: 'hotel@test.com',
        password: 'temppassword',
        hotelName: 'Test Hotel',
        city: 'Mumbai',
        state: 'Maharashtra',
        pinCode: '400001',
        passwordChangeRequired: true, // This flag enables force change
      });
    });

    test('SUCCESS: Should change password when required', async () => {
      const response = await request(app).post('/api/auth/change-password').send({
        userId: testHotel._id,
        newPassword: 'mynewpassword123',
      });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('Password updated successfully');

      // Verify password changed
      const updatedHotel = await Hotel.findById(testHotel._id).select('+password');
      const isMatch = await updatedHotel.matchPassword('mynewpassword123');
      expect(isMatch).toBe(true);
      expect(updatedHotel.passwordChangeRequired).toBe(false);
    });

    test('ERROR: Should fail without userId', async () => {
      const response = await request(app).post('/api/auth/change-password').send({
        newPassword: 'mynewpassword123',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('User ID and new password are required');
    });

    test('ERROR: Should fail without newPassword', async () => {
      const response = await request(app).post('/api/auth/change-password').send({
        userId: testHotel._id,
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('User ID and new password are required');
    });

    test('ERROR: Should fail with short password', async () => {
      const response = await request(app).post('/api/auth/change-password').send({
        userId: testHotel._id,
        newPassword: '12345',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('at least 6 characters');
    });

    test('ERROR: Should fail for non-existent user', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      const response = await request(app).post('/api/auth/change-password').send({
        userId: fakeId,
        newPassword: 'mynewpassword123',
      });

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('User not found');
    });

    test('SECURITY: Should fail when passwordChangeRequired is false', async () => {
      // Set flag to false (user shouldn't be able to use this route)
      testHotel.passwordChangeRequired = false;
      await testHotel.save();

      const response = await request(app).post('/api/auth/change-password').send({
        userId: testHotel._id,
        newPassword: 'mynewpassword123',
      });

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('not required');
    });

    test('SUCCESS: Should work for Police user', async () => {
      const policeStation = new mongoose.Types.ObjectId();
      const police = await Police.create({
        username: 'officer123',
        email: 'police@test.com',
        password: 'temppassword',
        rank: 'Inspector',
        policeStation,
        passwordChangeRequired: true,
      });

      const response = await request(app).post('/api/auth/change-password').send({
        userId: police._id,
        newPassword: 'mynewpassword123',
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
