const request = require('supertest');
const mongoose = require('mongoose');
const express = require('express');

// --- Models with 'src' prefix ---
const Guest = require('../src/models/Guest.model');
const Hotel = require('../src/models/Hotel.model');
const Watchlist = require('../src/models/Watchlist.model');
const Alert = require('../src/models/Alert.model');
const Notification = require('../src/models/Notification.model');
const PoliceStation = require('../src/models/PoliceStation.model');
const Police = require('../src/models/Police.model');
const AccessLog = require('../src/models/AccessLog.model');

// Test DB helpers
const { connectTestDB, closeTestDB, clearTestDB } = require('./testDb');

// Routes with 'src' prefix
const guestRoutes = require('../src/routes/guest.routes');

// ============================================================
// 🔧 FIX #1: Mock Authentication Middleware
// ============================================================
jest.mock('../src/middleware/auth.middleware', () => ({
  protect: (req, res, next) => {
    // Simulate successful authentication - attach fake user to req
    if (req.headers.authorization === 'Bearer valid-token') {
      req.user = {
        // Uses a plain string ID to avoid Mongoose hoisting issues
        _id: req.mockHotelId || '507f1f77bcf86cd799439011',
        role: 'Hotel',
        username: 'TestHotel',
        email: 'hotel@test.com',
      };
    } else {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }
    next();
  },
  authorize: (...roles) => {
    return (req, res, next) => {
      if (req.user && roles.includes(req.user.role)) {
        return next();
      }
      return res.status(403).json({ success: false, message: 'Not authorized for this role' });
    };
  },
}));

// Mock external services
jest.mock('../src/utils/cloudinary');
jest.mock('../src/utils/sendEmail');
jest.mock('../src/config/socket');

// Optionally mock Redis if you have it
// jest.mock('ioredis');

const { uploadToCloudinary } = require('../src/utils/cloudinary');
const { sendCheckoutEmail } = require('../src/utils/sendEmail');
const { getIO } = require('../src/config/socket');

describe('Guest Registration API Tests', () => {
  let app;
  let hotelUser;
  let authToken;

  beforeAll(async () => {
    // Connect to the Test Database
    await connectTestDB();

    // Create Express app
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Attach mockHotelId to req for auth mock to use
    app.use((req, res, next) => {
      req.mockHotelId = hotelUser?._id;
      next();
    });

    // Mount routes
    app.use('/api/guests', guestRoutes);

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
    // Create test hotel user
    hotelUser = await Hotel.create({
      username: 'TestHotel',
      email: 'hotel@test.com',
      password: 'hashedpassword123',
      hotelName: 'Test Grand Hotel',
      city: 'Mumbai',
      state: 'Maharashtra',
      pinCode: '400001',
      address: '123 Test Street',
      phone: '9876543210',
      rooms: [
        { roomNumber: '101', type: 'Deluxe', status: 'Vacant', guestId: null },
        {
          roomNumber: '102',
          type: 'Suite',
          status: 'Occupied',
          guestId: new mongoose.Types.ObjectId(),
        },
        { roomNumber: '103', type: 'Standard', status: 'Vacant', guestId: null },
      ],
      isApproved: true,
    });

    authToken = 'Bearer valid-token';

    // ============================================================
    // 🔧 FIX #2: Smart Cloudinary Mock
    // This ensures the mock returns the same fieldname it received.
    // This fixes the "image upload failed" errors in your logic tests.
    // ============================================================
    if (uploadToCloudinary.mock) {
      uploadToCloudinary.mockImplementation((file) => {
        return Promise.resolve({
          public_id: `guest-guard/${file.fieldname}-${Date.now()}`,
          url: `https://res.cloudinary.com/test/image/upload/${file.fieldname}.webp`,
          fieldname: file.fieldname,
        });
      });
    }

    // Mock Socket.io
    const mockIo = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };
    getIO.mockReturnValue(mockIo);

    // Mock SendGrid
    sendCheckoutEmail.mockResolvedValue({ success: true });
  });

  describe('POST /api/guests/register - Register Guest', () => {
    const validGuestData = {
      primaryGuestName: 'John Doe',
      primaryGuestDob: '1990-05-15',
      primaryGuestGender: 'Male',
      primaryGuestPhone: '9876543210',
      primaryGuestEmail: 'john.doe@example.com',
      primaryGuestAddressStreet: '456 Main St',
      primaryGuestAddressCity: 'Mumbai',
      primaryGuestAddressState: 'Maharashtra',
      primaryGuestAddressZipCode: '400001',
      primaryGuestNationality: 'Indian',
      idType: 'Aadhaar',
      idNumber: '1234-5678-9012',
      purposeOfVisit: 'Business',
      checkIn: new Date().toISOString(),
      expectedCheckout: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      roomNumber: '101',
    };

    const createMockFile = (fieldname) => ({
      fieldname,
      originalname: `${fieldname}.jpg`,
      encoding: '7bit',
      mimetype: 'image/jpeg',
      buffer: Buffer.from('fake-image-data'),
      size: 12345,
    });

    test('SUCCESS: Should register guest with all required fields', async () => {
      const response = await request(app)
        .post('/api/guests/register')
        .set('Authorization', authToken)
        .field('primaryGuestName', validGuestData.primaryGuestName)
        .field('primaryGuestDob', validGuestData.primaryGuestDob)
        .field('primaryGuestGender', validGuestData.primaryGuestGender)
        .field('primaryGuestPhone', validGuestData.primaryGuestPhone)
        .field('primaryGuestEmail', validGuestData.primaryGuestEmail)
        .field('primaryGuestAddressStreet', validGuestData.primaryGuestAddressStreet)
        .field('primaryGuestAddressCity', validGuestData.primaryGuestAddressCity)
        .field('primaryGuestAddressState', validGuestData.primaryGuestAddressState)
        .field('primaryGuestAddressZipCode', validGuestData.primaryGuestAddressZipCode)
        .field('primaryGuestNationality', validGuestData.primaryGuestNationality)
        .field('idType', validGuestData.idType)
        .field('idNumber', validGuestData.idNumber)
        .field('purposeOfVisit', validGuestData.purposeOfVisit)
        .field('checkIn', validGuestData.checkIn)
        .field('expectedCheckout', validGuestData.expectedCheckout)
        .field('roomNumber', validGuestData.roomNumber)
        .attach('idImageFront', createMockFile('idImageFront').buffer, 'front.jpg')
        .attach('idImageBack', createMockFile('idImageBack').buffer, 'back.jpg')
        .attach('livePhoto', createMockFile('livePhoto').buffer, 'live.jpg');

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('guest registered successfully');
      expect(response.body.data).toHaveProperty('_id');
      expect(response.body.data.primaryGuest.name).toBe(validGuestData.primaryGuestName);
      expect(response.body.data.idNumber).toBe(validGuestData.idNumber);
      expect(response.body.data.status).toBe('Checked-In');

      expect(uploadToCloudinary).toHaveBeenCalledTimes(3);

      const updatedHotel = await Hotel.findById(hotelUser._id);
      const room101 = updatedHotel.rooms.find((r) => r.roomNumber === '101');
      expect(room101.status).toBe('Occupied');
      expect(room101.guestId).toBeDefined();

      const guestInDb = await Guest.findOne({ idNumber: validGuestData.idNumber });
      expect(guestInDb).toBeDefined();
      expect(guestInDb.primaryGuest.name).toBe(validGuestData.primaryGuestName);
    });

    test('SUCCESS: Should register guest with accompanying adults', async () => {
      const accompanyingGuests = JSON.stringify([
        {
          name: 'Jane Doe',
          dob: '1992-08-20',
          gender: 'Female',
        },
      ]);

      const response = await request(app)
        .post('/api/guests/register')
        .set('Authorization', authToken)
        .field('primaryGuestName', validGuestData.primaryGuestName)
        .field('primaryGuestDob', validGuestData.primaryGuestDob)
        .field('primaryGuestGender', validGuestData.primaryGuestGender)
        .field('primaryGuestPhone', validGuestData.primaryGuestPhone)
        .field('primaryGuestEmail', validGuestData.primaryGuestEmail)
        .field('primaryGuestAddressStreet', validGuestData.primaryGuestAddressStreet)
        .field('primaryGuestAddressCity', validGuestData.primaryGuestAddressCity)
        .field('primaryGuestAddressState', validGuestData.primaryGuestAddressState)
        .field('primaryGuestAddressZipCode', validGuestData.primaryGuestAddressZipCode)
        .field('primaryGuestNationality', validGuestData.primaryGuestNationality)
        .field('idType', validGuestData.idType)
        .field('idNumber', validGuestData.idNumber)
        .field('purposeOfVisit', validGuestData.purposeOfVisit)
        .field('checkIn', validGuestData.checkIn)
        .field('expectedCheckout', validGuestData.expectedCheckout)
        .field('roomNumber', validGuestData.roomNumber)
        .field('accompanyingGuests', accompanyingGuests)
        .attach('idImageFront', Buffer.from('test'), 'front.jpg')
        .attach('idImageBack', Buffer.from('test'), 'back.jpg')
        .attach('livePhoto', Buffer.from('test'), 'live.jpg')
        .attach('accompanying_0_idImageFront', Buffer.from('test'), 'acc-front.jpg')
        .attach('accompanying_0_idImageBack', Buffer.from('test'), 'acc-back.jpg')
        .attach('accompanying_0_livePhoto', Buffer.from('test'), 'acc-live.jpg');

      expect(response.status).toBe(201);
      expect(response.body.data.accompanyingGuests.adults).toHaveLength(1);
      expect(response.body.data.accompanyingGuests.adults[0].name).toBe('Jane Doe');
    });

    test('SUCCESS: Should register guest with accompanying children', async () => {
      const accompanyingGuests = JSON.stringify([
        {
          name: 'Little John',
          dob: '2015-03-10', // Child (9 years old)
          gender: 'Male',
        },
      ]);

      const response = await request(app)
        .post('/api/guests/register')
        .set('Authorization', authToken)
        .field('primaryGuestName', validGuestData.primaryGuestName)
        .field('primaryGuestDob', validGuestData.primaryGuestDob)
        .field('primaryGuestGender', validGuestData.primaryGuestGender)
        .field('primaryGuestPhone', validGuestData.primaryGuestPhone)
        .field('primaryGuestEmail', validGuestData.primaryGuestEmail)
        .field('primaryGuestAddressStreet', validGuestData.primaryGuestAddressStreet)
        .field('primaryGuestAddressCity', validGuestData.primaryGuestAddressCity)
        .field('primaryGuestAddressState', validGuestData.primaryGuestAddressState)
        .field('primaryGuestAddressZipCode', validGuestData.primaryGuestAddressZipCode)
        .field('primaryGuestNationality', validGuestData.primaryGuestNationality)
        .field('idType', validGuestData.idType)
        .field('idNumber', validGuestData.idNumber)
        .field('purposeOfVisit', validGuestData.purposeOfVisit)
        .field('checkIn', validGuestData.checkIn)
        .field('expectedCheckout', validGuestData.expectedCheckout)
        .field('roomNumber', validGuestData.roomNumber)
        .field('accompanyingGuests', accompanyingGuests)
        .attach('idImageFront', Buffer.from('test'), 'front.jpg')
        .attach('idImageBack', Buffer.from('test'), 'back.jpg')
        .attach('livePhoto', Buffer.from('test'), 'live.jpg')
        .attach('accompanying_0_livePhoto', Buffer.from('test'), 'child-live.jpg');

      expect(response.status).toBe(201);
      expect(response.body.data.accompanyingGuests.children).toHaveLength(1);
      expect(response.body.data.accompanyingGuests.children[0].name).toBe('Little John');
    });

    test('ERROR: Should fail when no files are uploaded', async () => {
      const response = await request(app)
        .post('/api/guests/register')
        .set('Authorization', authToken)
        .field('primaryGuestName', validGuestData.primaryGuestName)
        .field('roomNumber', validGuestData.roomNumber);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('no files uploaded');
    });

    test('ERROR: Should fail when required image is missing', async () => {
      // We manually mock failure here because we are intentionally sending partial data
      // But for this specific test case, we just attach fewer files.
      // The Smart Mock handles the rest.

      const response = await request(app)
        .post('/api/guests/register')
        .set('Authorization', authToken)
        .field('primaryGuestName', validGuestData.primaryGuestName)
        .field('roomNumber', validGuestData.roomNumber)
        .attach('idImageFront', Buffer.from('test'), 'front.jpg')
        // MISSING idImageBack
        // MISSING livePhoto
        .attach('idImageBack', Buffer.from('test'), 'back.jpg');

      expect(response.status).toBe(400);
      // This error comes from your Controller validation logic
      expect(response.body.message).toContain('image upload failed');
    });

    test('ERROR: Should fail when room number is missing', async () => {
      const response = await request(app)
        .post('/api/guests/register')
        .set('Authorization', authToken)
        .field('primaryGuestName', validGuestData.primaryGuestName)
        .field('primaryGuestDob', validGuestData.primaryGuestDob)
        .field('primaryGuestGender', validGuestData.primaryGuestGender)
        .field('primaryGuestPhone', validGuestData.primaryGuestPhone)
        .field('primaryGuestEmail', validGuestData.primaryGuestEmail)
        .field('primaryGuestAddressCity', validGuestData.primaryGuestAddressCity)
        .field('idType', validGuestData.idType)
        .field('idNumber', validGuestData.idNumber)
        .field('purposeOfVisit', validGuestData.purposeOfVisit)
        // OMIT roomNumber
        .attach('idImageFront', Buffer.from('test'), 'front.jpg')
        .attach('idImageBack', Buffer.from('test'), 'back.jpg')
        .attach('livePhoto', Buffer.from('test'), 'live.jpg');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('room number is required');
    });

    test('ERROR: Should fail when room does not exist', async () => {
      const response = await request(app)
        .post('/api/guests/register')
        .set('Authorization', authToken)
        .field('primaryGuestName', validGuestData.primaryGuestName)
        .field('primaryGuestDob', validGuestData.primaryGuestDob)
        .field('primaryGuestGender', validGuestData.primaryGuestGender)
        .field('primaryGuestPhone', validGuestData.primaryGuestPhone)
        .field('primaryGuestEmail', validGuestData.primaryGuestEmail)
        .field('primaryGuestAddressCity', validGuestData.primaryGuestAddressCity)
        .field('idType', validGuestData.idType)
        .field('idNumber', validGuestData.idNumber)
        .field('purposeOfVisit', validGuestData.purposeOfVisit)
        .field('roomNumber', '999')
        .attach('idImageFront', Buffer.from('test'), 'front.jpg')
        .attach('idImageBack', Buffer.from('test'), 'back.jpg')
        .attach('livePhoto', Buffer.from('test'), 'live.jpg');

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('does not exist');
    });

    test('ERROR: Should fail when room is already occupied', async () => {
      const response = await request(app)
        .post('/api/guests/register')
        .set('Authorization', authToken)
        .field('primaryGuestName', validGuestData.primaryGuestName)
        .field('primaryGuestDob', validGuestData.primaryGuestDob)
        .field('primaryGuestGender', validGuestData.primaryGuestGender)
        .field('primaryGuestPhone', validGuestData.primaryGuestPhone)
        .field('primaryGuestEmail', validGuestData.primaryGuestEmail)
        .field('primaryGuestAddressCity', validGuestData.primaryGuestAddressCity)
        .field('idType', validGuestData.idType)
        .field('idNumber', validGuestData.idNumber)
        .field('purposeOfVisit', validGuestData.purposeOfVisit)
        .field('roomNumber', '102') // 102 is occupied in beforeEach
        .attach('idImageFront', Buffer.from('test'), 'front.jpg')
        .attach('idImageBack', Buffer.from('test'), 'back.jpg')
        .attach('livePhoto', Buffer.from('test'), 'live.jpg');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('already occupied');
    });

    test('ERROR: Should handle Cloudinary upload failure', async () => {
      // Override the smart mock just for this test
      uploadToCloudinary.mockRejectedValue(new Error('Cloudinary upload failed'));

      const response = await request(app)
        .post('/api/guests/register')
        .set('Authorization', authToken)
        .field('primaryGuestName', validGuestData.primaryGuestName)
        .field('roomNumber', '101')
        .attach('idImageFront', Buffer.from('test'), 'front.jpg')
        .attach('idImageBack', Buffer.from('test'), 'back.jpg')
        .attach('livePhoto', Buffer.from('test'), 'live.jpg');

      expect(response.status).toBe(500);
      expect(response.body.message).toContain('Cloudinary upload failed');
    });

    test('ERROR: Should fail when hotel user not found', async () => {
      await Hotel.findByIdAndDelete(hotelUser._id);

      const response = await request(app)
        .post('/api/guests/register')
        .set('Authorization', authToken)
        .field('primaryGuestName', validGuestData.primaryGuestName)
        .field('primaryGuestDob', validGuestData.primaryGuestDob)
        .field('primaryGuestGender', validGuestData.primaryGuestGender)
        .field('primaryGuestPhone', validGuestData.primaryGuestPhone)
        .field('primaryGuestEmail', validGuestData.primaryGuestEmail)
        .field('primaryGuestAddressCity', validGuestData.primaryGuestAddressCity)
        .field('idType', validGuestData.idType)
        .field('idNumber', validGuestData.idNumber)
        .field('purposeOfVisit', validGuestData.purposeOfVisit)
        .field('roomNumber', '101')
        .attach('idImageFront', Buffer.from('test'), 'front.jpg')
        .attach('idImageBack', Buffer.from('test'), 'back.jpg')
        .attach('livePhoto', Buffer.from('test'), 'live.jpg');

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('hotel user not found');
    });

    test('ERROR: Should handle database save errors', async () => {
      jest.spyOn(Guest, 'create').mockRejectedValueOnce(new Error('Database connection error'));

      const response = await request(app)
        .post('/api/guests/register')
        .set('Authorization', authToken)
        .field('primaryGuestName', validGuestData.primaryGuestName)
        .field('primaryGuestDob', validGuestData.primaryGuestDob)
        .field('primaryGuestGender', validGuestData.primaryGuestGender)
        .field('primaryGuestPhone', validGuestData.primaryGuestPhone)
        .field('primaryGuestEmail', validGuestData.primaryGuestEmail)
        .field('primaryGuestAddressCity', validGuestData.primaryGuestAddressCity)
        .field('idType', validGuestData.idType)
        .field('idNumber', validGuestData.idNumber)
        .field('purposeOfVisit', validGuestData.purposeOfVisit)
        .field('roomNumber', '101')
        .attach('idImageFront', Buffer.from('test'), 'front.jpg')
        .attach('idImageBack', Buffer.from('test'), 'back.jpg')
        .attach('livePhoto', Buffer.from('test'), 'live.jpg');

      expect(response.status).toBe(500);
      expect(response.body.message).toContain('Database connection error');

      Guest.create.mockRestore();
    });
  });

  describe('GET /api/guests/all - Get All Guests', () => {
    beforeEach(async () => {
      await Guest.create([
        {
          customerId: 'G-TEST001',
          primaryGuest: {
            name: 'Alice Smith',
            dob: new Date('1985-01-01'),
            gender: 'Female',
            phone: '1111111111',
            email: 'alice@test.com',
            address: { city: 'Mumbai', street: 'Test St', state: 'MH', zipCode: '400001' },
          },
          idType: 'Passport',
          idNumber: 'P1234567',
          idImageFront: { url: 'url1', public_id: 'id1' },
          idImageBack: { url: 'url2', public_id: 'id2' },
          livePhoto: { url: 'url3', public_id: 'id3' },
          stayDetails: {
            purposeOfVisit: 'Tourism',
            checkIn: new Date(),
            expectedCheckout: new Date(Date.now() + 86400000),
            roomNumber: '101',
          },
          hotel: hotelUser._id,
          accompanyingGuests: {
            adults: [{ name: 'Bob', dob: new Date('1990-01-01'), gender: 'Male' }],
            children: [],
          },
        },
        {
          customerId: 'G-TEST002',
          primaryGuest: {
            name: 'Bob Johnson',
            dob: new Date('1990-05-15'),
            gender: 'Male',
            phone: '2222222222',
            email: 'bob@test.com',
            address: { city: 'Mumbai', street: 'Test St', state: 'MH', zipCode: '400001' },
          },
          idType: 'Aadhaar',
          idNumber: 'A9876543210',
          idImageFront: { url: 'url4', public_id: 'id4' },
          idImageBack: { url: 'url5', public_id: 'id5' },
          livePhoto: { url: 'url6', public_id: 'id6' },
          stayDetails: {
            purposeOfVisit: 'Business',
            checkIn: new Date(),
            expectedCheckout: new Date(Date.now() + 86400000),
            roomNumber: '103',
          },
          hotel: hotelUser._id,
          accompanyingGuests: { adults: [], children: [] },
        },
      ]);
    });

    test('SUCCESS: Should return all guests for the hotel', async () => {
      const response = await request(app).get('/api/guests/all').set('Authorization', authToken);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);

      // 🔧 FIX: Find by Name instead of ID
      // (Because your Model overwrites the ID with a random value)
      const guestAlice = response.body.data.find((g) => g.primaryGuest.name === 'Alice Smith');
      const guestBob = response.body.data.find((g) => g.primaryGuest.name === 'Bob Johnson');

      // Verify Alice exists and has 1 adult
      expect(guestAlice).toBeDefined();
      expect(guestAlice.accompanyingGuests.adults).toHaveLength(1);

      // Verify Bob exists and has 0 adults
      expect(guestBob).toBeDefined();
      expect(guestBob.accompanyingGuests.adults).toHaveLength(0);
    });

    test('SUCCESS: Should return empty array when no guests exist', async () => {
      await Guest.deleteMany({});

      const response = await request(app).get('/api/guests/all').set('Authorization', authToken);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(0);
    });
  });

  describe("GET /api/guests/today - Get Today's Guests", () => {
    beforeEach(async () => {
      const today = new Date();
      const yesterday = new Date(Date.now() - 86400000);

      await Guest.create([
        {
          customerId: 'G-TODAY1',
          primaryGuest: {
            name: 'Today Guest 1',
            dob: new Date('1985-01-01'),
            gender: 'Male',
            phone: '3333333333',
            email: 'today1@test.com',
            address: { city: 'Mumbai', street: 'Test', state: 'MH', zipCode: '400001' },
          },
          idType: 'Passport',
          idNumber: 'T1234',
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
        },
        {
          customerId: 'G-YESTERDAY',
          primaryGuest: {
            name: 'Yesterday Guest',
            dob: new Date('1985-01-01'),
            gender: 'Female',
            phone: '4444444444',
            email: 'yesterday@test.com',
            address: { city: 'Mumbai', street: 'Test', state: 'MH', zipCode: '400001' },
          },
          idType: 'Aadhaar',
          idNumber: 'Y5678',
          idImageFront: { url: 'url', public_id: 'id' },
          idImageBack: { url: 'url', public_id: 'id' },
          livePhoto: { url: 'url', public_id: 'id' },
          stayDetails: {
            purposeOfVisit: 'Tourism',
            checkIn: yesterday,
            expectedCheckout: new Date(Date.now() + 86400000),
            roomNumber: '103',
          },
          hotel: hotelUser._id,
          registrationTimestamp: yesterday,
        },
      ]);
    });

    test("SUCCESS: Should return only today's guests", async () => {
      const response = await request(app).get('/api/guests/today').set('Authorization', authToken);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].primaryGuest.name).toBe('Today Guest 1');
    });
  });

  describe('PUT /api/guests/:id/checkout - Checkout Guest', () => {
    let testGuest;

    beforeEach(async () => {
      testGuest = await Guest.create({
        customerId: 'G-CHECKOUT',
        primaryGuest: {
          name: 'Checkout Guest',
          dob: new Date('1985-01-01'),
          gender: 'Male',
          phone: '5555555555',
          email: 'checkout@test.com',
          address: { city: 'Mumbai', street: 'Test', state: 'MH', zipCode: '400001' },
        },
        idType: 'Passport',
        idNumber: 'C1234',
        idImageFront: { url: 'url', public_id: 'id' },
        idImageBack: { url: 'url', public_id: 'id' },
        livePhoto: { url: 'url', public_id: 'id' },
        stayDetails: {
          purposeOfVisit: 'Business',
          checkIn: new Date(),
          expectedCheckout: new Date(Date.now() + 86400000),
          roomNumber: '101',
        },
        hotel: hotelUser._id,
        status: 'Checked-In',
      });
    });

    test('SUCCESS: Should checkout guest and send email', async () => {
      const response = await request(app)
        .put(`/api/guests/${testGuest._id}/checkout`)
        .set('Authorization', authToken);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('checked out successfully');

      const updatedGuest = await Guest.findById(testGuest._id);
      expect(updatedGuest.status).toBe('Checked-Out');
      expect(updatedGuest.stayDetails.checkOut).toBeDefined();

      const updatedHotel = await Hotel.findById(hotelUser._id);
      const room = updatedHotel.rooms.find((r) => r.roomNumber === '101');
      expect(room.status).toBe('Vacant');
      expect(room.guestId).toBeNull();

      expect(sendCheckoutEmail).toHaveBeenCalled();

      const accessLog = await AccessLog.findOne({ action: 'Guest Checkout' });
      expect(accessLog).toBeDefined();
    });

    test('ERROR: Should fail when guest not found', async () => {
      const fakeId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .put(`/api/guests/${fakeId}/checkout`)
        .set('Authorization', authToken);

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('guest not found');
    });

    test('ERROR: Should fail when guest already checked out', async () => {
      testGuest.status = 'Checked-Out';
      await testGuest.save();

      const response = await request(app)
        .put(`/api/guests/${testGuest._id}/checkout`)
        .set('Authorization', authToken);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('already been checked out');
    });

    test('SUCCESS: Should checkout even if email fails', async () => {
      sendCheckoutEmail.mockRejectedValueOnce(new Error('Email service down'));

      const response = await request(app)
        .put(`/api/guests/${testGuest._id}/checkout`)
        .set('Authorization', authToken);

      expect(response.status).toBe(200);

      const updatedGuest = await Guest.findById(testGuest._id);
      expect(updatedGuest.status).toBe('Checked-Out');
    });
  });

  describe('GET /api/guests/report - Generate Guest Report', () => {
    beforeEach(async () => {
      const baseDate = new Date('2024-01-15');

      await Guest.create([
        {
          customerId: 'G-REPORT1',
          primaryGuest: {
            name: 'Report Guest 1',
            dob: new Date('1985-01-01'),
            gender: 'Male',
            phone: '6666666666',
            email: 'report1@test.com',
            address: { city: 'Mumbai', street: 'Test', state: 'MH', zipCode: '400001' },
          },
          idType: 'Passport',
          idNumber: 'R1234',
          idImageFront: { url: 'url', public_id: 'id' },
          idImageBack: { url: 'url', public_id: 'id' },
          livePhoto: { url: 'url', public_id: 'id' },
          stayDetails: {
            purposeOfVisit: 'Business',
            checkIn: baseDate,
            expectedCheckout: new Date('2024-01-20'),
            roomNumber: '101',
          },
          hotel: hotelUser._id,
          registrationTimestamp: baseDate,
        },
        {
          customerId: 'G-REPORT2',
          primaryGuest: {
            name: 'Report Guest 2',
            dob: new Date('1990-05-15'),
            gender: 'Female',
            phone: '7777777777',
            email: 'report2@test.com',
            address: { city: 'Mumbai', street: 'Test', state: 'MH', zipCode: '400001' },
          },
          idType: 'Aadhaar',
          idNumber: 'R5678',
          idImageFront: { url: 'url', public_id: 'id' },
          idImageBack: { url: 'url', public_id: 'id' },
          livePhoto: { url: 'url', public_id: 'id' },
          stayDetails: {
            purposeOfVisit: 'Tourism',
            checkIn: new Date('2024-01-18'),
            expectedCheckout: new Date('2024-01-25'),
            roomNumber: '103',
          },
          hotel: hotelUser._id,
          registrationTimestamp: new Date('2024-01-18'),
        },
      ]);
    });

    test('SUCCESS: Should generate CSV report for date range', async () => {
      const response = await request(app)
        .get('/api/guests/report')
        .query({ startDate: '2024-01-10', endDate: '2024-01-20' })
        .set('Authorization', authToken);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.text).toContain('Report Guest 1');
      expect(response.text).toContain('Report Guest 2');
    });

    test('ERROR: Should fail when date parameters are missing', async () => {
      const response = await request(app).get('/api/guests/report').set('Authorization', authToken);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('startDate');
    });

    test('ERROR: Should fail when startDate is after endDate', async () => {
      const response = await request(app)
        .get('/api/guests/report')
        .query({ startDate: '2024-01-20', endDate: '2024-01-10' })
        .set('Authorization', authToken);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('cannot be after');
    });

    test('ERROR: Should fail when no guests found in date range', async () => {
      const response = await request(app)
        .get('/api/guests/report')
        .query({ startDate: '2024-02-01', endDate: '2024-02-28' })
        .set('Authorization', authToken);

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('No guest records found');
    });
  });

  describe('Watchlist Integration Tests', () => {
    let policeStation;
    let policeOfficer;
    let watchlistEntry;

    beforeEach(async () => {
      policeStation = await PoliceStation.create({
        name: 'Mumbai Central Police Station',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincodes: ['400001', '400002'],
      });

      policeOfficer = await Police.create({
        username: 'officer123',
        email: 'officer@police.gov',
        password: 'hashedpass',
        badgeNumber: 'P12345',
        rank: 'Inspector',
        policeStation: policeStation._id,
      });

      watchlistEntry = await Watchlist.create({
        type: 'ID_Number', // Matches the Model Enum
        value: 'WATCHLIST-ID-123',
        reason: 'Suspected fraud',
        addedBy: policeOfficer._id,
        addedByModel: 'Police',
      });
    });

    test('SUCCESS: Should trigger watchlist alert when guest matches', async () => {
      const response = await request(app)
        .post('/api/guests/register')
        .set('Authorization', authToken)
        .field('primaryGuestName', 'Suspicious Person')
        .field('primaryGuestDob', '1990-01-01')
        .field('primaryGuestGender', 'Male')
        .field('primaryGuestPhone', '9999999999')
        .field('primaryGuestEmail', 'suspicious@test.com')
        .field('primaryGuestAddressCity', 'Mumbai')
        .field('idType', 'Aadhaar')
        .field('idNumber', 'WATCHLIST-ID-123') // Matches watchlist
        .field('purposeOfVisit', 'Business')
        .field('checkIn', new Date().toISOString())
        .field('expectedCheckout', new Date(Date.now() + 86400000).toISOString())
        .field('roomNumber', '101')
        .attach('idImageFront', Buffer.from('test'), 'front.jpg')
        .attach('idImageBack', Buffer.from('test'), 'back.jpg')
        .attach('livePhoto', Buffer.from('test'), 'live.jpg');

      expect(response.status).toBe(201);

      // Wait a bit for async watchlist check
      await new Promise((resolve) => setTimeout(resolve, 100));

      const alert = await Alert.findOne({ reason: /AUTOMATIC FLAG/ });
      expect(alert).toBeDefined();
      expect(alert.status).toBe('Open');

      const notification = await Notification.findOne({
        recipientUser: policeOfficer._id,
      });
      expect(notification).toBeDefined();
      expect(notification.message).toContain('WATCHLIST MATCH');

      const mockIo = getIO();
      expect(mockIo.to).toHaveBeenCalled();
      expect(mockIo.emit).toHaveBeenCalled();
    });
  });
});
