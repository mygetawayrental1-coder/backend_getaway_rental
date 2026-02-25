const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscription.controller');
const { authenticate } = require('../middleware/auth');
const { isAdmin, requireRole, ROLES } = require('../middleware/roles');

// Public routes
router.get('/plans', subscriptionController.getAllPlans);
router.get('/plans/:id', subscriptionController.getPlanById);

// Admin only - plan management
router.post('/plans', authenticate, isAdmin, subscriptionController.createPlan);
router.put('/plans/:id', authenticate, isAdmin, subscriptionController.updatePlan);
router.delete('/plans/:id', authenticate, isAdmin, subscriptionController.deletePlan);

// Owner routes - subscription management
router.post('/', authenticate, requireRole(ROLES.OWNER), subscriptionController.subscribe);
router.post('/subscribe', authenticate, requireRole(ROLES.OWNER), subscriptionController.subscribe);
router.get('/my', authenticate, requireRole(ROLES.OWNER), subscriptionController.getMySubscription);
router.get('/my-subscription', authenticate, requireRole(ROLES.OWNER), subscriptionController.getMySubscription);
router.post('/cancel', authenticate, requireRole(ROLES.OWNER), subscriptionController.cancelSubscription);

module.exports = router;
