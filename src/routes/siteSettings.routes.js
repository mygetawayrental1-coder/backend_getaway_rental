const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/siteSettings.controller');
const { authenticate } = require('../../middleware/auth');
const { isAdmin } = require('../../middleware/roles');

// Public — website + flutter app
router.get('/contact', ctrl.getContact);
router.get('/destination-order', ctrl.getDestinationOrder);
router.get('/category-order', ctrl.getCategoryOrder);

// Admin only
router.get('/', authenticate, isAdmin, ctrl.listAll);
router.get('/destination-order-admin', authenticate, isAdmin, ctrl.getDestinationOrder);
router.get('/category-order-admin', authenticate, isAdmin, ctrl.getCategoryOrder);
router.put('/contact', authenticate, isAdmin, ctrl.updateContact);
router.put('/destination-order', authenticate, isAdmin, ctrl.updateDestinationOrder);
router.put('/category-order', authenticate, isAdmin, ctrl.updateCategoryOrder);

module.exports = router;


