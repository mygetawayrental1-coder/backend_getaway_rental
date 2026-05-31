const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/booking.controller');
const { authenticate, optionalAuth } = require('../middleware/auth');

router.post('/check-availability', optionalAuth, bookingController.checkAvailability);
router.post('/create', optionalAuth, bookingController.createBooking);

router.get('/owner/orders', authenticate, bookingController.getOwnerBookings);
router.get('/my', authenticate, bookingController.getGuestBookings);

router.patch('/:id/confirm', authenticate, bookingController.confirmBooking);
router.patch('/:id/ongoing', authenticate, bookingController.markOngoing);
router.patch('/:id/complete', authenticate, bookingController.completeBooking);
router.patch('/:id/cancel', authenticate, bookingController.cancelBooking);
router.patch('/:id/notes', authenticate, bookingController.updateOwnerNotes);

router.get('/:id', authenticate, bookingController.getBookingById);

module.exports = router;
