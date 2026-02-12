const request = require('supertest');
const { connectTestDB, closeTestDB, clearTestDB } = require('./testDb');
const app = require('../src/app');
const RegionalAdmin = require('../src/models/RegionalAdmin.model');
const Hotel = require('../src/models/Hotel.model');

// Mock External Services
jest.mock('../src/config/redisClient', () => ({
  client: { get: jest.fn(), set: jest.fn() },
}));

jest.mock('../src/utils/sendEmail', () => ({
  sendCredentialsEmail: jest.fn().mockResolvedValue(true),
}));

describe('Admin User Management Tests', () => {
  let adminCookie;

  beforeAll(async () => {
    await connectTestDB();
  });

  // Before each test, create an Admin and log them in to get the cookie
  beforeEach(async () => {
    // 1. Create Admin
    await RegionalAdmin.create({
      username: 'admin',
      email: 'admin@gov.in',
      password: 'password123',
      role: 'Regional Admin',
      status: 'Active',
      passwordChangeRequired: false,
    });

    // 2. Login Admin
    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'admin@gov.in',
      password: 'password123',
      loginType: 'Regional Admin',
    });

    // 3. Store Cookie for tests
    adminCookie = loginRes.headers['set-cookie'];
  });

  afterEach(async () => {
    await clearTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  // =========================================================================
  // POST /api/users/register (Admin creating a Hotel)
  // =========================================================================
  describe('POST /api/users/register', () => {
    it('should allow Admin to register a new Hotel user', async () => {
      const newHotelData = {
        username: 'taj_hotel',
        email: 'manager@taj.com',
        role: 'Hotel',
        details: {
          hotelName: 'Taj Hotel',
          ownerName: 'Mr. Ratan',
          gstNumber: 'GST12345',
          phone: '9876543210',
          address: '123 Marine Drive',
          city: 'Mumbai',
          state: 'Maharashtra',
          pinCode: '400001',
          nationality: 'Indian',
          ownerSignature: { public_id: 'sig1', url: 'http://sig.com' },
          hotelStamp: { public_id: 'stamp1', url: 'http://stamp.com' },
          aadhaarCard: { public_id: 'uid1', url: 'http://uid.com' },
        },
      };

      const res = await request(app)
        .post('/api/users/register')
        .set('Cookie', adminCookie) // <--- ATTACH ADMIN COOKIE
        .send(newHotelData);

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.username).toBe('taj_hotel');
      expect(res.body.data.message).toContain('Credentials have been emailed');

      // Verify in DB
      const hotelInDb = await Hotel.findOne({ email: 'manager@taj.com' });
      expect(hotelInDb).toBeTruthy();
      expect(hotelInDb.hotelName).toBe('Taj Hotel');
    });

    it('should fail if non-admin tries to register user', async () => {
      // No Cookie Sent
      const res = await request(app).post('/api/users/register').send({
        username: 'hacker',
        email: 'hacker@test.com',
        role: 'Hotel',
      });

      expect(res.statusCode).toBe(401); // Unauthorized
    });

    it('should fail if email already exists', async () => {
      // First Registration
      await request(app)
        .post('/api/users/register')
        .set('Cookie', adminCookie)
        .send({
          username: 'hotel1',
          email: 'duplicate@test.com',
          role: 'Hotel',
          details: { hotelName: 'H1' },
        });

      // Second Registration (Same Email)
      const res = await request(app)
        .post('/api/users/register')
        .set('Cookie', adminCookie)
        .send({
          username: 'hotel2',
          email: 'duplicate@test.com',
          role: 'Hotel',
          details: { hotelName: 'H2' },
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/already exists/i);
    });
  });
});
