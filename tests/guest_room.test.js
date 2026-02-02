const request = require('supertest');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setup');
const app = require('../src/app');
const Hotel = require('../src/models/Hotel.model');
const Guest = require('../src/models/Guest.model');
const mongoose = require('mongoose');

// =========================================================================
// 1. ROBUST MOCKS
// =========================================================================

// Mock Redis (Simple & Safe)
jest.mock('../src/config/redisClient', () => ({
    client: {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue('OK'),
    },
}));

// Mock Cloudinary (The Fix for 500 Error)
// We define it simply to guarantee it returns the expected structure
jest.mock('../src/utils/cloudinary', () => ({
    uploadToCloudinary: jest.fn((file) => {
        // console.log("🧪 Mock Cloudinary called for:", file.fieldname); // Uncomment to debug
        return Promise.resolve({
            url: `http://mock-cloudinary.com/${file.fieldname}.jpg`,
            public_id: `mock_id_${file.fieldname}`,
            fieldname: file.fieldname // <--- Critical: Controller needs this!
        });
    }),
}));

// Mock Socket.io
jest.mock('../src/config/socket', () => ({
    getIO: () => ({
        to: () => ({ emit: jest.fn() })
    })
}));

// Mock PDF & Email
jest.mock('../src/utils/pdfGenerator', () => jest.fn().mockResolvedValue(Buffer.from('fake-pdf')));
jest.mock('../src/utils/sendEmail', () => ({
    sendCheckoutEmail: jest.fn().mockResolvedValue(true)
}));

// Import mocks to assert usage later
const generateGuestPDF = require('../src/utils/pdfGenerator');
const { sendCheckoutEmail } = require('../src/utils/sendEmail');


// =========================================================================
// 2. TEST SUITE
// =========================================================================

describe('Hotel Room & Guest Flow Integration', () => {
    
    let hotelCookie;
    let hotelId;
    const testRoomNumber = '101';

    beforeAll(async () => {
        await connectTestDB();
    });

    beforeEach(async () => {
        await clearTestDB();
        jest.clearAllMocks();

        // 1. Create Hotel with Unique Data
        const uniqueSuffix = Date.now();
        const hotelData = {
            username: `grand_hotel_${uniqueSuffix}`,
            email: `reception_${uniqueSuffix}@grand.com`,
            password: 'password123',
            role: 'Hotel',
            status: 'Active',
            passwordChangeRequired: false,
            hotelName: 'The Grand',
            pinCode: '452001',
            rooms: []
        };

        const hotel = await Hotel.create(hotelData);
        hotelId = hotel._id;

        // 2. Login (Fix for 401 Errors)
        const loginRes = await request(app)
            .post('/api/auth/login')
            .send({ 
                email: hotelData.email, 
                password: 'password123', 
                loginType: 'Hotel' 
            });

        if (loginRes.statusCode !== 200) {
            console.error("❌ Login Failed inside Test Setup:", loginRes.body);
            throw new Error("Test Setup Failed: Could not login");
        }

        hotelCookie = loginRes.headers['set-cookie'];
    });

    afterAll(async () => {
        await closeTestDB();
    });

    // =========================================================================
    // SCENARIO 1: ROOM MANAGEMENT
    // =========================================================================
    describe('Room Management', () => {
        it('should add a new room successfully', async () => {
            const res = await request(app)
                .post('/api/rooms')
                .set('Cookie', hotelCookie)
                .send({ roomNumber: testRoomNumber });

            expect(res.statusCode).toBe(201);
            expect(res.body.data.roomNumber).toBe(testRoomNumber);
            expect(res.body.data.status).toBe('Vacant');
        });

        it('should prevent duplicate room numbers', async () => {
            await request(app).post('/api/rooms').set('Cookie', hotelCookie).send({ roomNumber: '202' });
            
            const res = await request(app)
                .post('/api/rooms')
                .set('Cookie', hotelCookie)
                .send({ roomNumber: '202' });

            expect(res.statusCode).toBe(400);
            expect(res.body.message).toMatch(/already exists/i);
        });
    });

    // =========================================================================
    // SCENARIO 2: GUEST REGISTRATION & CHECKOUT
    // =========================================================================
    describe('Guest Lifecycle', () => {
        
        beforeEach(async () => {
            // Setup a room for the guest
            await request(app)
                .post('/api/rooms')
                .set('Cookie', hotelCookie)
                .send({ roomNumber: testRoomNumber });
        });

        it('should register a guest and mark room as Occupied', async () => {
            const fakeBuffer = Buffer.from('fake-image');

            const res = await request(app)
                .post('/api/guests/register')
                .set('Cookie', hotelCookie)
                .field('primaryGuestName', 'John Doe')
                .field('primaryGuestDob', '1990-01-01')
                .field('primaryGuestGender', 'Male')
                .field('primaryGuestPhone', '9876543210')
                .field('primaryGuestEmail', 'john@guest.com')
                .field('primaryGuestAddressCity', 'New York')
                .field('idType', 'Passport')
                .field('idNumber', 'A1234567')
                .field('purposeOfVisit', 'Tourism')
                .field('expectedCheckout', new Date(Date.now() + 86400000).toISOString())
                .field('roomNumber', testRoomNumber)
                // Attach Files
                .attach('idImageFront', fakeBuffer, 'front.jpg')
                .attach('idImageBack', fakeBuffer, 'back.jpg')
                .attach('livePhoto', fakeBuffer, 'live.jpg');

            // Log error if it fails
            if (res.statusCode === 500) console.error("500 Error Body:", res.body);

            expect(res.statusCode).toBe(201);
            expect(res.body.success).toBe(true);
            const guestId = res.body.data._id;

            // Verify Room Status
            const hotel = await Hotel.findById(hotelId);
            const room = hotel.rooms.find(r => r.roomNumber === testRoomNumber);
            expect(room.status).toBe('Occupied');
            expect(room.guestId.toString()).toBe(guestId);
        });

        it('should checkout guest and free the room', async () => {
            const fakeBuffer = Buffer.from('img');
            
            // 1. Register
            const registerRes = await request(app)
                .post('/api/guests/register')
                .set('Cookie', hotelCookie)
                .field('primaryGuestName', 'Jane Doe')
                .field('primaryGuestDob', '1995-05-05')
                .field('primaryGuestGender', 'Female')
                .field('primaryGuestPhone', '1234567890')
                .field('primaryGuestEmail', 'jane@guest.com')
                .field('primaryGuestAddressCity', 'London')
                .field('idType', 'Visa')
                .field('idNumber', 'V99999')
                .field('purposeOfVisit', 'Business')
                .field('expectedCheckout', new Date().toISOString())
                .field('roomNumber', testRoomNumber)
                .attach('idImageFront', fakeBuffer, 'f.jpg')
                .attach('idImageBack', fakeBuffer, 'b.jpg')
                .attach('livePhoto', fakeBuffer, 'l.jpg');

            const guestId = registerRes.body.data._id;

            // 2. Checkout
            const checkoutRes = await request(app)
                .put(`/api/guests/${guestId}/checkout`)
                .set('Cookie', hotelCookie);

            expect(checkoutRes.statusCode).toBe(200);

            // 3. Verify
            const hotel = await Hotel.findById(hotelId);
            const room = hotel.rooms.find(r => r.roomNumber === testRoomNumber);
            expect(room.status).toBe('Vacant');
            expect(room.guestId).toBeNull();

            expect(generateGuestPDF).toHaveBeenCalled();
            expect(sendCheckoutEmail).toHaveBeenCalled();
        });

        it('should fail to register if room does not exist', async () => {
            const fakeBuffer = Buffer.from('img');
            const res = await request(app)
                .post('/api/guests/register')
                .set('Cookie', hotelCookie)
                .field('primaryGuestName', 'Test')
                .field('primaryGuestDob', '1990-01-01')
                .field('primaryGuestGender', 'Male')
                .field('primaryGuestPhone', '0000000000')
                .field('primaryGuestEmail', 'test@test.com')
                .field('primaryGuestAddressCity', 'City')
                .field('idType', 'ID')
                .field('idNumber', '123')
                .field('purposeOfVisit', 'Test')
                .field('expectedCheckout', new Date().toISOString())
                .field('roomNumber', '999') // Non-existent
                .attach('idImageFront', fakeBuffer, 'f.jpg')
                .attach('idImageBack', fakeBuffer, 'b.jpg')
                .attach('livePhoto', fakeBuffer, 'l.jpg');

            expect(res.statusCode).toBe(404);
            expect(res.body.message).toMatch(/room "999" does not exist/i);
        });
    });
});