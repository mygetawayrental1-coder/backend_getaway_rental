const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard.controller');
const { authenticate } = require('../middleware/auth');

router.get('/stats', authenticate, dashboardController.getStats);

module.exports = router;
