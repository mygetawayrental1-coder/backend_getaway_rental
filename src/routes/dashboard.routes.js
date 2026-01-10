const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard.controller');
const { authenticate } = require('../middleware/auth');
const { isAdmin } = require('../middleware/roles');

// Dashboard routes (Admin only)
router.get('/stats', authenticate, isAdmin, dashboardController.getStats);

module.exports = router;
