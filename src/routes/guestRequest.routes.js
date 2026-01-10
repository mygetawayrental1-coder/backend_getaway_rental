const express = require('express');
const router = express.Router();
const guestRequestController = require('../controllers/guestRequest.controller');
const { authenticate } = require('../middleware/auth');

// PUBLIC route - guests can submit requests without auth
router.post('/', guestRequestController.createGuestRequest);

// PROTECTED routes - require authentication
router.get('/my', authenticate, guestRequestController.getOwnerGuestRequests);
router.get('/:id', authenticate, guestRequestController.getGuestRequestById);
router.patch('/:id/status', authenticate, guestRequestController.updateGuestRequestStatus);
router.delete('/:id', authenticate, guestRequestController.deleteGuestRequest);

module.exports = router;
