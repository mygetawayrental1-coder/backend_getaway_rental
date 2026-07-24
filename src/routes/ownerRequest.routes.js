const express = require('express');
const router = express.Router();
const ownerRequestController = require('../controllers/ownerRequest.controller');
const { authenticate } = require('../middleware/auth');
const { isAdmin } = require('../middleware/roles');

// Create become-a-host / owner onboarding request
router.post('/', authenticate, ownerRequestController.createBecomeOwnerRequest);

// Create custom pricing request (authenticated owner)
router.post('/custom-pricing', authenticate, ownerRequestController.createCustomPricingRequest);

// Create custom pricing request (public / guest — no auth required)
router.post('/custom-pricing/guest', ownerRequestController.createGuestCustomPricingRequest);

// Owner: Get my requests
router.get('/my', authenticate, ownerRequestController.getMyRequests);

// Admin only: Get all requests
router.get('/', authenticate, isAdmin, ownerRequestController.getAllRequests);

// Admin only: Update request status
router.patch('/:id/status', authenticate, isAdmin, ownerRequestController.updateRequestStatus);
router.delete('/:id', authenticate, isAdmin, ownerRequestController.deleteRequest);

module.exports = router;
