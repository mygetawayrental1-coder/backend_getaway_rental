const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const { authenticate } = require('../middleware/auth');
const { isAdmin } = require('../middleware/roles');

router.get('/status', authenticate, isAdmin, paymentController.getPayPalStatus);
router.post('/create-order', authenticate, paymentController.createOrder);
router.post('/verify', authenticate, paymentController.verifyPayment);
router.get('/history', authenticate, paymentController.getPaymentHistory);
router.get('/:id', authenticate, paymentController.getPaymentById);

module.exports = router;
