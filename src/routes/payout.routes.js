const express = require('express');
const router = express.Router();
const payoutController = require('../controllers/payout.controller');
const { authenticate } = require('../middleware/auth');
const { requireOwner, requireAdmin } = require('../middleware/roles');

router.get('/earnings', authenticate, requireOwner, payoutController.getEarningsSummary);
router.get('/history', authenticate, requireOwner, payoutController.getPayoutHistory);
router.post('/request', authenticate, requireOwner, payoutController.requestPayout);

router.get('/admin/all', authenticate, requireAdmin, payoutController.getAllPayouts);
router.patch('/:id/process', authenticate, requireAdmin, payoutController.processPayout);

module.exports = router;
