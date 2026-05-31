const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/web/pricing.web.controller');

router.get('/', ctrl.getPricingPlans);

module.exports = router;
