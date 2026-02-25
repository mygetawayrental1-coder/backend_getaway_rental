const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/booking.controller');
const { authenticate } = require('../middleware/auth');
const { requireRole, ROLES } = require('../middleware/roles');

// PUBLIC ROUTES - No authentication required for guests to check availability and book

/**
 * Check property availability for given dates
 * POST /bookings/check-availability
 * Body: { propertyId, checkin, checkout }
 */
router.post('/check-availability', bookingController.checkAvailability);

/**
 * Create a new booking (instant reservation)
 * POST /bookings/create
 * Body: { propertyId, guestName, guestEmail, guestPhone, checkin, checkout, guests, notes }
 */
router.post('/create', bookingController.createBooking);

/**
 * Get booking details by ID or bookingId
 * GET /bookings/:id
 */
router.get('/:id', bookingController.getBookingById);

// PROTECTED ROUTES - Require authentication (for property owners/admin)

/**
 * Get all bookings for a specific property
 * GET /bookings/property/:propertyId
 * Requires: Owner of property or Admin
 */
router.get('/property/:propertyId', authenticate, bookingController.getPropertyBookings);

/**
 * Get all owner orders (bookings globally across all owner properties)
 * GET /bookings/owner/orders
 * Requires: Owner or Admin
 */
router.get('/owner/orders', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), bookingController.getOwnerBookingsGlobal);

/**
 * Cancel a booking
 * PATCH /bookings/:id/cancel
 * Requires: Authentication (can be enhanced to check if user is guest or owner)
 */
router.patch('/:id/cancel', authenticate, bookingController.cancelBooking);

module.exports = router;
