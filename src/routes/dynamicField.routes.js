const express = require('express');
const router = express.Router();
const dynamicFieldController = require('../controllers/dynamicField.controller');
const { authenticate } = require('../middleware/auth');
const { requireRole, ROLES } = require('../middleware/roles');

// Public routes
router.get('/', dynamicFieldController.getDynamicFields);
router.get('/listing-config', dynamicFieldController.getListingFormConfig);

// Admin-only routes to manage fields
router.get('/admin', authenticate, requireRole(ROLES.ADMIN), dynamicFieldController.adminGetDynamicFields);
router.post('/', authenticate, requireRole(ROLES.ADMIN), dynamicFieldController.createDynamicField);
router.put('/:id', authenticate, requireRole(ROLES.ADMIN), dynamicFieldController.updateDynamicField);
router.delete('/:id', authenticate, requireRole(ROLES.ADMIN), dynamicFieldController.deleteDynamicField);

module.exports = router;
