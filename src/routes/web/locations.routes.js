const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/web/locations.web.controller');

router.get('/', ctrl.listLocations);
router.get('/:slug', ctrl.getBySlug);

module.exports = router;
