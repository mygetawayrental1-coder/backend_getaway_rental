const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/booking.controller');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { requireAdmin, requireRole, ROLES } = require('../middleware/roles');

router.post('/check-availability', optionalAuth, bookingController.checkAvailability);
router.post('/create', optionalAuth, bookingController.createBooking);

router.get('/admin/all', authenticate, requireAdmin, bookingController.getAdminBookings);
router.get('/owner/orders', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), bookingController.getOwnerBookings);
router.get('/my', authenticate, bookingController.getGuestBookings);

router.patch('/:id/confirm', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), bookingController.confirmBooking);
router.patch('/:id/ongoing', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), bookingController.markOngoing);
router.patch('/:id/complete', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), bookingController.completeBooking);
router.patch('/:id/cancel', authenticate, bookingController.cancelBooking);
router.patch('/:id/notes', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), bookingController.updateOwnerNotes);

router.get('/:id', authenticate, bookingController.getBookingById);

module.exports = router;
