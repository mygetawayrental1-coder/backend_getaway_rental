const express = require('express');
const router = express.Router();
const couponController = require('../controllers/coupon.controller');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/roles');

router.post('/', authenticate, requireAdmin, couponController.createCoupon);
router.get('/', authenticate, requireAdmin, couponController.listCoupons);
router.patch('/:id/toggle', authenticate, requireAdmin, couponController.toggleCoupon);
router.delete('/:id', authenticate, requireAdmin, couponController.deleteCoupon);

module.exports = router;
