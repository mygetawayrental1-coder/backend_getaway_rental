const express = require('express');
const router = express.Router();
const propertyController = require('../controllers/property.controller');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { uploadMultiple, handleUploadError } = require('../middleware/upload');
const { requireRole, isAdminOrOwner, ROLES } = require('../middleware/roles');

// ——— Static paths first (never use /:id before these) ———

// Public
router.get('/fetch-all', optionalAuth, propertyController.getAllProperties);
router.get('/location-suggestions', propertyController.getLocationSuggestions);
router.all('/fetch-property-by-location', propertyController.getPropertiesByLocation);

// Owner dashboard
router.get('/mine', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), propertyController.getMyProperties);
router.post('/create-property', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), uploadMultiple, handleUploadError, propertyController.createProperty);
router.post('/fetch-property-by-email', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), propertyController.getPropertiesByEmail);
router.get('/fetch-property-by-email/:email', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), propertyController.getPropertiesByEmail);

// ——— Parameterized routes ———
router.get('/:id/availability', propertyController.getAvailability);
router.get('/:id', optionalAuth, propertyController.getPropertyById);
router.put('/:id', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), uploadMultiple, handleUploadError, propertyController.updateProperty);
router.post('/:id/availability', authenticate, propertyController.setAvailability);
router.delete('/:id/availability', authenticate, propertyController.clearAvailability);
router.delete('/:id', authenticate, isAdminOrOwner, propertyController.deleteProperty);

module.exports = router;
