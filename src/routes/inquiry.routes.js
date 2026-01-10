const express = require('express');
const router = express.Router();
const inquiryController = require('../controllers/inquiry.controller');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { requireRole, isAdmin, isAdminOrOwner, ROLES } = require('../middleware/roles');

// Create inquiry (public with optional auth)
router.post('/create', optionalAuth, inquiryController.createInquiry);

// Admin only
router.get('/fetch-all', authenticate, isAdmin, inquiryController.getAllInquiries);
router.delete('/:id', authenticate, isAdmin, inquiryController.deleteInquiry);

// Owner routes
router.get('/fetch-inquiry-emailId/:email', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), inquiryController.getInquiriesByEmail);
router.get('/:id', authenticate, isAdminOrOwner, inquiryController.getInquiryById);
router.get('/:id/accept', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), inquiryController.acceptInquiry);
router.get('/:id/reject', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), inquiryController.rejectInquiry);

module.exports = router;
