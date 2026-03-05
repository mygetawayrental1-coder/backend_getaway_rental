const express = require('express');
const router = express.Router();
const icalController = require('../controllers/ical.controller');
const { protect } = require('../middlewares/auth.middleware');

// Manual trigger for importing an external calendar
// Can be protected depending on who should trigger it (e.g. owner of the property)
router.post('/import', protect, icalController.importIcs);

// Public route: AirBnb/Booking.com will hit this URL to fetch your property's bookings
// e.g. GET /ical/export/cuid1234.ics
router.get('/export/:propertyId', icalController.exportIcs);

// Public/Internal route: For frontend calendars to quickly block out dates
router.get('/booked-dates/:propertyId', icalController.getBookedDates);

module.exports = router;
