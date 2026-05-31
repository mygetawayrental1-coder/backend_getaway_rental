const express = require('express');
const router = express.Router();
const propertyController = require('../controllers/property.controller');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { uploadMultiple } = require('../middleware/upload');
const { requireRole, isAdminOrOwner, ROLES } = require('../middleware/roles');

// Public routes
router.get('/fetch-all', optionalAuth, propertyController.getAllProperties);
router.get('/location-suggestions', propertyController.getLocationSuggestions);
router.all('/fetch-property-by-location', propertyController.getPropertiesByLocation); // Support both GET and POST
router.get('/:id/availability', propertyController.getAvailability);
router.get('/:id', optionalAuth, propertyController.getPropertyById);

// Protected routes
router.post('/create-property', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), uploadMultiple, propertyController.createProperty);
router.post('/fetch-property-by-email', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), propertyController.getPropertiesByEmail);
router.get('/fetch-property-by-email/:email', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), propertyController.getPropertiesByEmail);
router.put('/:id', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), uploadMultiple, propertyController.updateProperty);
router.post('/:id/availability', authenticate, propertyController.setAvailability);
router.delete('/:id/availability', authenticate, propertyController.clearAvailability);
router.delete('/:id', authenticate, isAdminOrOwner, propertyController.deleteProperty);

module.exports = router;
