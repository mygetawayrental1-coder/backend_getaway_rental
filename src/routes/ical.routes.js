const express = require('express');
const router = express.Router();
const icalController = require('../controllers/ical.controller');
const { authenticate } = require('../middleware/auth');
const { requireRole, ROLES } = require('../middleware/roles');

// Owner/admin only — import external calendar for a property they own
router.post('/import', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), icalController.importIcs);

// Public route: AirBnb/Booking.com will hit this URL to fetch your property's bookings
// e.g. GET /ical/export/cuid1234.ics
router.get('/export/:propertyId', icalController.exportIcs);

// Public/Internal route: For frontend calendars to quickly block out dates
router.get('/booked-dates/:propertyId', icalController.getBookedDates);

module.exports = router;
