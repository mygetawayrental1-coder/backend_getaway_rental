const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { authenticate } = require('../middleware/auth');
const { isAdmin } = require('../middleware/roles');

// Owner routes (Admin only)
router.get('/', authenticate, isAdmin, userController.getAllOwners);
router.get('/:id', authenticate, isAdmin, userController.getOwnerById);

module.exports = router;
