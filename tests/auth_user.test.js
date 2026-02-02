const request = require('supertest');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setup');
const app = require('../src/app');
const Hotel = require('../src/models/Hotel.model');

// =========================================================================
// 1. MOCKING EXTERNAL SERVICES
// =========================================================================

// Mock Redis Client
jest.mock('../src/config/redisClient', () => ({
    client: {
        get: jest.fn(),
        set: jest.fn(),
    },
}));

// Mock Email Service
jest.mock('../src/utils/sendEmail', () => ({
    sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
}));

// =========================================================================
// 2. TEST SUITE
// =========================================================================

describe('Authentication Integration Tests', () => {
    
    beforeAll(async () => {
        await connectTestDB();
    });

    afterEach(async () => {
        await clearTestDB();
        jest.clearAllMocks(); 
    });

    afterAll(async () => {
        await closeTestDB();
    });

    // =========================================================================
    // POST /api/auth/login
    // =========================================================================
    describe('POST /api/auth/login', () => {
        
        const seedHotelUser = async () => {
            return await Hotel.create({
                username: 'hotel_owner',
                email: 'hotel@example.com',
                password: 'password123',
                role: 'Hotel',
                status: 'Active',
                passwordChangeRequired: false,
                hotelName: 'Grand Hotel',
            });
        };

        it('should login successfully with correct credentials', async () => {
            await seedHotelUser();

            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'hotel@example.com',
                    password: 'password123',
                    loginType: 'Hotel'
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.username).toBe('hotel_owner');
            
            // Check Cookies
            const cookies = res.headers['set-cookie'];
            expect(cookies).toBeDefined();
            expect(cookies[0]).toMatch(/jwt=/);
            expect(cookies[0]).toMatch(/HttpOnly/);
        });

        it('should return 401 for invalid password', async () => {
            await seedHotelUser();

            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'hotel@example.com',
                    password: 'wrongpassword',
                });

            expect(res.statusCode).toBe(401);
            expect(res.body.success).toBe(false);
        });

        it('should return 401 for non-existent email', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'ghost@example.com',
                    password: 'password123',
                });

            expect(res.statusCode).toBe(401);
        });

        it('should return 400 if email or password is missing', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({ email: 'hotel@example.com' });

            expect(res.statusCode).toBe(400);
        });

        it('should return 202 if password change is required', async () => {
            await Hotel.create({
                username: 'new_hotel',
                email: 'new@example.com',
                password: 'password123',
                status: 'Active',
                passwordChangeRequired: true, 
                hotelName: 'New Hotel'
            });

            const res = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'new@example.com',
                    password: 'password123'
                });

            expect(res.statusCode).toBe(202);
            expect(res.body.message).toMatch(/password change required/i);
        });
    });

    // =========================================================================
    // POST /api/auth/logout
    // =========================================================================
    describe('POST /api/auth/logout', () => {
        
        it('should logout successfully and clear cookie', async () => {
            // 1. Seed & Login
            await Hotel.create({
                username: 'logout_user',
                email: 'logout@example.com',
                password: 'password123',
                status: 'Active',
                passwordChangeRequired: false,
                hotelName: 'Logout Hotel'
            });

            const loginRes = await request(app)
                .post('/api/auth/login')
                .send({ email: 'logout@example.com', password: 'password123' });

            const loginCookie = loginRes.headers['set-cookie'];

            // 2. Logout
            const res = await request(app)
                .post('/api/auth/logout')
                .set('Cookie', loginCookie); 

            // 3. Assertions
            expect(res.statusCode).toBe(200);
            
            const logoutCookie = res.headers['set-cookie'][0];
            // Check for empty jwt AND immediate expiration (Max-Age=0)
            expect(logoutCookie).toMatch(/jwt=;/);
            expect(logoutCookie).toMatch(/Max-Age=0/); 
        });
    });
});