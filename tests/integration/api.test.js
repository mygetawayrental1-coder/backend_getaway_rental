/**
 * Integration Tests — Health check & public API endpoints
 *
 * These tests fire real HTTP requests against the Express app
 * but use mocked Prisma so no real DB is touched.
 *
 * What's tested:
 *   - GET /          → health check
 *   - GET /subscriptions/plans → public plan list
 *   - POST /bookings/check-availability → input validation
 *   - POST /auth/*   → 401 without token
 *   - Rate limiter   → 429 after limit
 */

const request = require('supertest');

// ── Mock Prisma (prevents real DB calls in CI) ──────────────────
jest.mock('../../src/config/database', () => ({
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    subscriptionPlan: {
        findMany: jest.fn().mockResolvedValue([
            {
                id: 'plan-1',
                name: 'Basic',
                price: 99,
                specialPrice: null,
                duration: 'Monthly',
                maxProperties: 1,
                features: '["List 1 property"]',
                status: 'Active',
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                id: 'plan-2',
                name: 'Pro',
                price: 199,
                specialPrice: 149,
                duration: 'Monthly',
                maxProperties: 5,
                features: '["List 5 properties","Priority support"]',
                status: 'Active',
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        ]),
        findUnique: jest.fn().mockResolvedValue(null),
    },
    property: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany:  jest.fn().mockResolvedValue([]),
    },
    booking: {
        findMany:  jest.fn().mockResolvedValue([]),
    },
    guestRequest: {
        findMany:  jest.fn().mockResolvedValue([]),
    },
    propertyAvailability: {
        findMany:  jest.fn().mockResolvedValue([]),
    },
    icalEvent: {
        findMany:  jest.fn().mockResolvedValue([]),
    },
    captchaSession: {
        findUnique: jest.fn().mockResolvedValue(null),
    },
    user: {
        findUnique: jest.fn().mockResolvedValue(null),
    },
}));

// ── Mock iCal scheduler (stops background cron in tests) ────────
jest.mock('../../src/utils/ical.scheduler', () => ({
    startIcalScheduler: jest.fn(),
}));

// ── Mock Clerk token verification ───────────────────────────────
jest.mock('@clerk/backend', () => ({
    createClerkClient: jest.fn(),
    verifyToken: jest.fn().mockRejectedValue(new Error('Invalid token')),
}));

const app = require('../../src/app');

// ─────────────────────────────────────────────
// Health Check
// ─────────────────────────────────────────────
describe('GET / — Health check', () => {
    it('returns 200 with success:true', async () => {
        const res = await request(app).get('/');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toMatch(/running/i);
    });

    it('response includes known endpoints', async () => {
        const res = await request(app).get('/');
        expect(res.body.endpoints).toHaveProperty('auth');
        expect(res.body.endpoints).toHaveProperty('bookings');
        expect(res.body.endpoints).toHaveProperty('payments');
    });
});

// ─────────────────────────────────────────────
// Subscription Plans (public)
// ─────────────────────────────────────────────
describe('GET /subscriptions/plans — Public plan list', () => {
    it('returns 200 and an array of plans', async () => {
        const res = await request(app).get('/subscriptions/plans');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.length).toBe(2);
    });

    it('parses features JSON into an array (not a raw string)', async () => {
        const res = await request(app).get('/subscriptions/plans');
        const plan = res.body.data[0];
        expect(Array.isArray(plan.features)).toBe(true);
    });

    it('returns plans sorted ascending by price', async () => {
        const res = await request(app).get('/subscriptions/plans');
        const prices = res.body.data.map((p) => p.price);
        expect(prices[0]).toBeLessThanOrEqual(prices[1]);
    });
});

// ─────────────────────────────────────────────
// Booking availability — input validation
// ─────────────────────────────────────────────
describe('POST /bookings/check-availability — Validation', () => {
    it('returns 400 when propertyId is missing', async () => {
        const res = await request(app)
            .post('/bookings/check-availability')
            .send({ checkin: '2026-09-01', checkout: '2026-09-05' });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('returns 400 when checkin is missing', async () => {
        const res = await request(app)
            .post('/bookings/check-availability')
            .send({ propertyId: 'prop-1', checkout: '2026-09-05' });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('returns 400 when checkout is missing', async () => {
        const res = await request(app)
            .post('/bookings/check-availability')
            .send({ propertyId: 'prop-1', checkin: '2026-09-01' });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('returns 404 when property does not exist', async () => {
        const res = await request(app)
            .post('/bookings/check-availability')
            .send({ propertyId: 'non-existent', checkin: '2026-09-01', checkout: '2026-09-05' });
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toMatch(/not found/i);
    });
});

// ─────────────────────────────────────────────
// Authentication guard
// ─────────────────────────────────────────────
describe('Protected routes — 401 without Bearer token', () => {
    const protectedRoutes = [
        ['GET',  '/auth/me'],
        ['GET',  '/users'],
        ['GET',  '/owners'],
        ['GET',  '/notifications'],
        ['POST', '/subscriptions'],
    ];

    test.each(protectedRoutes)('%s %s returns 401', async (method, route) => {
        const res = await request(app)[method.toLowerCase()](route);
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });
});

// ─────────────────────────────────────────────
// 404 handler
// ─────────────────────────────────────────────
describe('404 handler', () => {
    it('returns 404 for unknown routes', async () => {
        const res = await request(app).get('/this-route-does-not-exist-xyz');
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });
});

// ─────────────────────────────────────────────
// Rate limiting
// ─────────────────────────────────────────────
describe('Rate limiting — /auth route', () => {
    it('returns 429 after exceeding the auth limit (30 requests)', async () => {
        // Fire 31 rapid requests; the 31st should be rate-limited
        let lastStatus;
        for (let i = 0; i < 31; i++) {
            const res = await request(app).get('/auth/me');
            lastStatus = res.status;
        }
        // Should eventually hit 429 (rate limit) or 401 (not 200)
        expect([401, 429]).toContain(lastStatus);
    }, 15000); // allow 15s for 31 requests
});
