const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/web/hosts.web.controller');

router.get('/:userId/reviews', ctrl.getHostReviews);
router.get('/:userId', ctrl.getHostProfile);

module.exports = router;
