const express = require('express');
const router = express.Router();
const guestRequestController = require('../controllers/guestRequest.controller');
const { authenticate } = require('../middleware/auth');
const { requireRole, ROLES } = require('../middleware/roles');

// PUBLIC route - guests can submit requests without auth
router.post('/', guestRequestController.createGuestRequest);

// OWNER-only — guest booking requests for property hosts with a plan.
router.get('/my', authenticate, requireRole(ROLES.OWNER), guestRequestController.getOwnerGuestRequests);
router.get('/:id', authenticate, requireRole(ROLES.OWNER), guestRequestController.getGuestRequestById);
router.patch('/:id/status', authenticate, requireRole(ROLES.OWNER), guestRequestController.updateGuestRequestStatus);
router.delete('/:id', authenticate, requireRole(ROLES.OWNER), guestRequestController.deleteGuestRequest);

module.exports = router;
