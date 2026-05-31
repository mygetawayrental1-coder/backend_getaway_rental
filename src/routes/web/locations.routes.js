const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/web/locations.web.controller');
const { authenticate } = require('../../middleware/auth');
const { isAdmin } = require('../../middleware/roles');

router.get('/admin/all', authenticate, isAdmin, ctrl.listAllAdmin);
router.post('/', authenticate, isAdmin, ctrl.createLocation);
router.put('/:slug', authenticate, isAdmin, ctrl.updateLocation);
router.get('/', ctrl.listLocations);
router.get('/:slug/properties', ctrl.getLocationProperties);
router.get('/:slug', ctrl.getBySlug);

module.exports = router;
