// tests/user.test.js
const request = require('supertest');
const mongoose = require('mongoose');
const express = require('express');

// Models
const Hotel = require('../src/models/Hotel.model');
const Police = require('../src/models/Police.model');
const RegionalAdmin = require('../src/models/RegionalAdmin.model');
const HotelInquiry = require('../src/models/HotelInquiry.model');
const AccessLog = require('../src/models/AccessLog.model');
const Guest = require('../src/models/Guest.model');
const PoliceStation = require('../src/models/PoliceStation.model');

// Test DB helpers
const { connectTestDB, closeTestDB, clearTestDB } = require('./testDb');

// Routes
const userRoutes = require('../src/routes/user.routes');

// ============================================================
// MOCK AUTH MIDDLEWARE (Must be before importing routes)
// ============================================================
jest.mock('../src/middleware/auth.middleware', () => ({
  protect: (req, res, next) => {
    // 1. Check for Authorization header presence
    if (!req.headers.authorization || !req.headers.authorization.startsWith('Bearer')) {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    // 2. PRIORITY: Check for explicit test user data first
    // This allows tests to inject exactly the user they need (Hotel, Police, etc.)
    if (req.headers['testuser']) {
      try {
        req.user = JSON.parse(req.headers['testuser']);
        return next();
      } catch (e) {
        return res.status(401).json({ success: false, message: 'Invalid test user header' });
      }
    }

    // 3. Fallback: Default Admin for setup/teardown
    // Only used if no specific test user is provided
    const token = req.headers.authorization.split(' ')[1];
    if (token === 'valid-token') {
      req.user = {
        _id: '507f1f77bcf86cd799439011',
        role: 'Regional Admin',
        username: 'admin',
        email: 'admin@test.com',
      };
      return next();
    }

    // 4. If neither, unauthorized
    return res.status(401).json({ success: false, message: 'Not authorized' });
  },
  authorize: (...roles) => {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'User not found' });
      }
      if (!roles.includes(req.user.role)) {
        return res
          .status(403)
          .json({ success: false, message: `User role ${req.user.role} is not authorized` });
      }
      next();
    };
  },
}));

// Mock external services
jest.mock('../src/utils/sendEmail');
jest.mock('../src/utils/aiService');

const { sendCredentialsEmail } = require('../src/utils/sendEmail');
const { generateDailySummary } = require('../src/utils/aiService');

describe('User Management API Tests', () => {
  let app;
  let adminUser;
  let hotelUser;
  let policeUser;

  beforeAll(async () => {
    await connectTestDB();

    // Create Express app
    app = express();
    app.use(express.json());

    // Middleware to attach mock user data to request
    app.use((req, res, next) => {
      req.mockUserId = req.testUser?._id;
      req.mockUserRole = req.testUser?.role;
      req.mockUsername = req.testUser?.username;
      req.mockUserEmail = req.testUser?.email;
      next();
    });

    app.use('/api/users', userRoutes);

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

  beforeEach(async () => {
    // Create test users
    adminUser = await RegionalAdmin.create({
      username: 'admin',
      email: 'admin@test.com',
      password: 'password123',
      passwordChangeRequired: false,
    });

    hotelUser = await Hotel.create({
      username: 'testhotel',
      email: 'hotel@test.com',
      password: 'password123',
      hotelName: 'Test Grand Hotel',
      city: 'Mumbai',
      state: 'Maharashtra',
      pinCode: '400001',
      passwordChangeRequired: false,
    });

    const policeStation = await PoliceStation.create({
      name: 'Test Station',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincodes: ['400001'],
    });

    policeUser = await Police.create({
      username: 'officer123',
      email: 'police@test.com',
      password: 'password123',
      rank: 'Inspector',
      policeStation: policeStation._id,
      passwordChangeRequired: false,
    });

    // Mock email service
    sendCredentialsEmail.mockResolvedValue(true);
  });

  describe('POST /api/users/register - Register New User', () => {
    test('SUCCESS: Should register hotel user as admin', async () => {
      const response = await request(app)
        .post('/api/users/register')
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...adminUser.toObject(), role: 'Regional Admin' }))
        .send({
          username: 'newhotel',
          email: 'newhotel@test.com',
          role: 'Hotel',
          details: {
            hotelName: 'New Hotel',
            city: 'Delhi',
            state: 'Delhi',
            pinCode: '110001',
            phone: '9876543210',
          },
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.username).toBe('newhotel');
      expect(response.body.data.password).toBeDefined();
      expect(sendCredentialsEmail).toHaveBeenCalled();

      // Verify user created
      const user = await Hotel.findOne({ email: 'newhotel@test.com' });
      expect(user).toBeDefined();
      expect(user.passwordChangeRequired).toBe(true);
    });

    test('SUCCESS: Should register police user as admin', async () => {
      const policeStation = await PoliceStation.findOne();

      const response = await request(app)
        .post('/api/users/register')
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...adminUser.toObject(), role: 'Regional Admin' }))
        .send({
          username: 'newofficer',
          email: 'newofficer@test.com',
          role: 'Police',
          details: {
            rank: 'Constable',
          },
          policeStation: policeStation._id,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);

      const user = await Police.findOne({ email: 'newofficer@test.com' });
      expect(user).toBeDefined();
    });

    test('SUCCESS: Should register Regional Admin', async () => {
      const response = await request(app)
        .post('/api/users/register')
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...adminUser.toObject(), role: 'Regional Admin' }))
        .send({
          username: 'newadmin',
          email: 'newadmin@test.com',
          role: 'Regional Admin',
          details: {},
        });

      expect(response.status).toBe(201);
      const user = await RegionalAdmin.findOne({ email: 'newadmin@test.com' });
      expect(user).toBeDefined();
    });

    test('ERROR: Should fail with duplicate email', async () => {
      const response = await request(app)
        .post('/api/users/register')
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...adminUser.toObject(), role: 'Regional Admin' }))
        .send({
          username: 'duplicate',
          email: 'hotel@test.com', // Already exists
          role: 'Hotel',
          details: { hotelName: 'Hotel' },
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('already exists');
    });

    test('ERROR: Should fail without required fields', async () => {
      const response = await request(app)
        .post('/api/users/register')
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...adminUser.toObject(), role: 'Regional Admin' }))
        .send({
          email: 'test@test.com',
          // Missing username and role
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('required');
    });

    test('ERROR: Should fail for police without policeStation', async () => {
      const response = await request(app)
        .post('/api/users/register')
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...adminUser.toObject(), role: 'Regional Admin' }))
        .send({
          username: 'officer',
          email: 'officer@test.com',
          role: 'Police',
          details: { rank: 'Constable' },
          // Missing policeStation
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Police station is required');
    });

    test('SUCCESS: Should continue even if email fails', async () => {
      sendCredentialsEmail.mockRejectedValue(new Error('Email failed'));

      const response = await request(app)
        .post('/api/users/register')
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...adminUser.toObject(), role: 'Regional Admin' }))
        .send({
          username: 'testuser',
          email: 'testuser@test.com',
          role: 'Hotel',
          details: { hotelName: 'Test' },
        });

      expect(response.status).toBe(201);
      const user = await Hotel.findOne({ email: 'testuser@test.com' });
      expect(user).toBeDefined();
    });
  });

  describe('GET /api/users/profile - Get User Profile', () => {
    test('SUCCESS: Should get hotel user profile', async () => {
      const response = await request(app)
        .get('/api/users/profile')
        .set('Authorization', 'Bearer valid-token')
        // Using correct header to bypass auth mock logic
        .set('testUser', JSON.stringify({ ...hotelUser.toObject(), role: 'Hotel' }));

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.email).toBe('hotel@test.com');
      expect(response.body.data.role).toBe('Hotel');
      expect(response.body.data.password).toBeUndefined();
    });

    test('SUCCESS: Should get police user profile', async () => {
      const response = await request(app)
        .get('/api/users/profile')
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...policeUser.toObject(), role: 'Police' }));

      expect(response.status).toBe(200);
      expect(response.body.data.email).toBe('police@test.com');
      expect(response.body.data.role).toBe('Police');
    });

    test('ERROR: Should fail without authentication', async () => {
      const response = await request(app).get('/api/users/profile');

      expect(response.status).toBe(401);
    });
  });

  describe('PUT /api/users/profile - Update User Profile', () => {
    test('SUCCESS: Should update hotel profile', async () => {
      const response = await request(app)
        .put('/api/users/profile')
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...hotelUser.toObject(), role: 'Hotel' }))
        .send({
          email: 'newemail@test.com',
          city: 'Delhi', // Send directly (removed "details" wrapper)
        });

      expect(response.status).toBe(200);
      expect(response.body.data.email).toBe('newemail@test.com');

      const updatedHotel = await Hotel.findById(hotelUser._id);
      expect(updatedHotel.email).toBe('newemail@test.com');
    });

    test('ERROR: Should fail with duplicate email', async () => {
      const response = await request(app)
        .put('/api/users/profile')
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...hotelUser.toObject(), role: 'Hotel' }))
        .send({
          email: 'police@test.com', // Already used by police
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('already in use');
    });
  });

  describe('PUT /api/users/change-password - Change Password', () => {
    test('SUCCESS: Should change password', async () => {
      const response = await request(app)
        .put('/api/users/change-password')
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...hotelUser.toObject(), role: 'Hotel' }))
        .send({
          oldPassword: 'password123',
          newPassword: 'newpassword123',
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('updated successfully');

      const updatedHotel = await Hotel.findById(hotelUser._id).select('+password');
      const isMatch = await updatedHotel.matchPassword('newpassword123');
      expect(isMatch).toBe(true);
    });

    test('ERROR: Should fail with wrong old password', async () => {
      const response = await request(app)
        .put('/api/users/change-password')
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...hotelUser.toObject(), role: 'Hotel' }))
        .send({
          oldPassword: 'wrongpassword',
          newPassword: 'newpassword123',
        });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('incorrect');
    });

    test('ERROR: Should fail with short password', async () => {
      const response = await request(app)
        .put('/api/users/change-password')
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...hotelUser.toObject(), role: 'Hotel' }))
        .send({
          oldPassword: 'password123',
          newPassword: '12345',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('at least 6 characters');
    });
  });

  describe('GET /api/users/admin/dashboard - Admin Dashboard', () => {
    beforeEach(async () => {
      // Create some guests for today
      const today = new Date();
      await Guest.create({
        customerId: 'G-TEST1',
        primaryGuest: {
          name: 'Test Guest',
          dob: new Date('1990-01-01'),
          gender: 'Male',
          phone: '9876543210',
          email: 'guest@test.com',
          address: { city: 'Mumbai', street: 'Test St', state: 'MH', zipCode: '400001' },
        },
        idType: 'Aadhaar',
        idNumber: 'TEST123',
        idImageFront: { url: 'url', public_id: 'id' },
        idImageBack: { url: 'url', public_id: 'id' },
        livePhoto: { url: 'url', public_id: 'id' },
        stayDetails: {
          purposeOfVisit: 'Business',
          checkIn: today,
          expectedCheckout: new Date(Date.now() + 86400000),
          roomNumber: '101',
        },
        hotel: hotelUser._id,
        registrationTimestamp: today,
      });
    });

    test('SUCCESS: Should get dashboard data', async () => {
      const response = await request(app)
        .get('/api/users/admin/dashboard')
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...adminUser.toObject(), role: 'Regional Admin' }));

      expect(response.status).toBe(200);
      expect(response.body.data.metrics).toHaveProperty('hotels');
      expect(response.body.data.metrics).toHaveProperty('police');
      expect(response.body.data.metrics).toHaveProperty('guestsToday');
      expect(response.body.data.metrics.hotels).toBeGreaterThan(0);
      expect(response.body.data.users).toHaveProperty('hotels');
      expect(response.body.data.users).toHaveProperty('police');
    });
  });

  describe('GET /api/users/admin/ai-report - AI Daily Report', () => {
    beforeEach(async () => {
      generateDailySummary.mockResolvedValue(
        "This is an AI-generated summary of today's activities."
      );
    });

    test('SUCCESS: Should generate AI report for hotel', async () => {
      const response = await request(app)
        .get('/api/users/admin/ai-report')
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...hotelUser.toObject(), role: 'Hotel' }));

      expect(response.status).toBe(200);
      expect(response.body.data.summary).toBeDefined();
      expect(response.body.data.source).toBe('live');
      expect(generateDailySummary).toHaveBeenCalled();
    });

    test('SUCCESS: Should generate AI report for admin', async () => {
      const response = await request(app)
        .get('/api/users/admin/ai-report')
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...adminUser.toObject(), role: 'Regional Admin' }));

      expect(response.status).toBe(200);
      expect(response.body.data.summary).toBeDefined();
    });

    test('ERROR: Should fail for police role', async () => {
      const response = await request(app)
        .get('/api/users/admin/ai-report')
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...policeUser.toObject(), role: 'Police' }));

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('not authorized');
    });
  });

  describe('GET /api/users/admin/hotels - Get Hotels', () => {
    test('SUCCESS: Should get all hotels', async () => {
      const response = await request(app)
        .get('/api/users/admin/hotels')
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...adminUser.toObject(), role: 'Regional Admin' }));

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].email).toBe('hotel@test.com');
    });

    test('SUCCESS: Should filter hotels by search term', async () => {
      const response = await request(app)
        .get('/api/users/admin/hotels')
        .query({ searchTerm: 'Test Grand' })
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...adminUser.toObject(), role: 'Regional Admin' }));

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    test('SUCCESS: Should filter hotels by status', async () => {
      const response = await request(app)
        .get('/api/users/admin/hotels')
        .query({ status: 'Active' })
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...adminUser.toObject(), role: 'Regional Admin' }));

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/users/police - Get Police Users', () => {
    test('SUCCESS: Should get all police users', async () => {
      const response = await request(app)
        .get('/api/users/police')
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...adminUser.toObject(), role: 'Regional Admin' }));

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].email).toBe('police@test.com');
    });
  });

  describe('PUT /api/users/:id/status - Update User Status', () => {
    test('SUCCESS: Should update hotel status', async () => {
      const response = await request(app)
        .put(`/api/users/${hotelUser._id}/status`)
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...adminUser.toObject(), role: 'Regional Admin' }))
        .send({ status: 'Suspended' });

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('Suspended');

      const updatedHotel = await Hotel.findById(hotelUser._id);
      expect(updatedHotel.status).toBe('Suspended');
    });

    test('ERROR: Should fail with invalid status', async () => {
      const response = await request(app)
        .put(`/api/users/${hotelUser._id}/status`)
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...adminUser.toObject(), role: 'Regional Admin' }))
        .send({ status: 'InvalidStatus' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Valid status');
    });

    test('ERROR: Should fail for non-existent user', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .put(`/api/users/${fakeId}/status`)
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...adminUser.toObject(), role: 'Regional Admin' }))
        .send({ status: 'Active' });

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('not found');
    });
  });

  describe('DELETE /api/users/:id - Delete User', () => {
    test('SUCCESS: Should delete hotel user', async () => {
      const response = await request(app)
        .delete(`/api/users/${hotelUser._id}`)
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...adminUser.toObject(), role: 'Regional Admin' }));

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('deleted successfully');

      const deletedHotel = await Hotel.findById(hotelUser._id);
      expect(deletedHotel).toBeNull();
    });

    test('SUCCESS: Should delete police user', async () => {
      const response = await request(app)
        .delete(`/api/users/${policeUser._id}`)
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...adminUser.toObject(), role: 'Regional Admin' }));

      expect(response.status).toBe(200);

      const deletedPolice = await Police.findById(policeUser._id);
      expect(deletedPolice).toBeNull();
    });

    test('ERROR: Should fail for non-existent user', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .delete(`/api/users/${fakeId}`)
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...adminUser.toObject(), role: 'Regional Admin' }));

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('not found');
    });
  });

  describe('GET /api/users/admin/logs - Get Access Logs', () => {
    beforeEach(async () => {
      await AccessLog.create({
        user: hotelUser._id,
        userModel: 'Hotel',
        action: 'Guest Registration',
        reason: 'Registered new guest',
        timestamp: new Date(),
      });
    });

    test('SUCCESS: Should get access logs', async () => {
      const response = await request(app)
        .get('/api/users/admin/logs')
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...adminUser.toObject(), role: 'Regional Admin' }));

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    test('SUCCESS: Should filter logs by search term', async () => {
      const response = await request(app)
        .get('/api/users/admin/logs')
        .query({ searchTerm: 'Registration' })
        .set('Authorization', 'Bearer valid-token')
        .set('testUser', JSON.stringify({ ...adminUser.toObject(), role: 'Regional Admin' }));

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeGreaterThan(0);
    });
  });
});
