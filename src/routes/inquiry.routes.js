const express = require('express');
const router = express.Router();
const inquiryController = require('../controllers/inquiry.controller');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { requireRole, isAdmin, isAdminOrOwner, ROLES } = require('../middleware/roles');

// Create inquiry (public with optional auth)
router.post('/create', optionalAuth, inquiryController.createInquiry);

// Admin only — inquiry moderation removed intentionally.
// Guest booking requests are scoped to property owners only.

// Owner routes
router.get('/fetch-inquiry-emailId/:email', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), inquiryController.getInquiriesByEmail);
router.get('/:id', authenticate, isAdminOrOwner, inquiryController.getInquiryById);
router.patch('/:id/accept', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), inquiryController.acceptInquiry);
router.patch('/:id/reject', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), inquiryController.rejectInquiry);

module.exports = router;
