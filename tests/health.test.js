// tests/health.test.js
const request = require('supertest');
const app = require('../src/app'); // Importing the app we just separated

describe('API Health Check', () => {
  it('GET / should return 200 and welcome message', async () => {
    const res = await request(app).get('/');

    // 1. Check Status Code
    expect(res.statusCode).toEqual(200);

    // 2. Check Response Body
    expect(res.text).toContain('Server is running');
  });
});
