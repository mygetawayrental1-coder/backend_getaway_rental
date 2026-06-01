const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const subscriptionController = require('../controllers/subscription.controller');
const couponController = require('../controllers/coupon.controller');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { isAdmin, requireRole, ROLES } = require('../middleware/roles');

const couponLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
});

// Public routes
router.get('/plans', subscriptionController.getAllPlans);
router.get('/plans/:id', subscriptionController.getPlanById);
router.post('/validate-coupon', couponLimiter, optionalAuth, couponController.validateCoupon);

// Admin only - plan management
router.post('/plans', authenticate, isAdmin, subscriptionController.createPlan);
router.put('/plans/:id', authenticate, isAdmin, subscriptionController.updatePlan);
router.delete('/plans/:id', authenticate, isAdmin, subscriptionController.deletePlan);

// Owner routes - subscription management (ADMIN can subscribe for testing)
router.post('/', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), subscriptionController.subscribe);
router.post('/subscribe', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), subscriptionController.subscribe);
router.get('/my', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), subscriptionController.getMySubscription);
router.get('/my-subscription', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), subscriptionController.getMySubscription);
router.post('/cancel', authenticate, requireRole(ROLES.OWNER, ROLES.ADMIN), subscriptionController.cancelSubscription);

module.exports = router;
