const express = require('express');
const router = express.Router();
const payoutController = require('../controllers/payout.controller');
const { authenticate } = require('../middleware/auth');
const { requireOwner, requireAdmin } = require('../middleware/roles');

router.get('/earnings', authenticate, payoutController.getEarningsSummary);
router.get('/history', authenticate, payoutController.getPayoutHistory); // returns bookings
router.post('/:bookingId/payment', authenticate, payoutController.logPayment);
router.delete('/payment/:paymentId', authenticate, payoutController.deletePayment);

router.get('/admin/all', authenticate, requireAdmin, payoutController.getAllPayouts);
router.patch('/:id/process', authenticate, requireAdmin, payoutController.processPayout);

module.exports = router;
