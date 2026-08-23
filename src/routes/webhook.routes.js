const express = require('express');
const { handleClerk, handlePayPal } = require('../controllers/webhook.controller');

const router = express.Router();

router.post('/clerk', express.raw({ type: 'application/json' }), handleClerk);
router.post('/paypal', express.json(), handlePayPal);

module.exports = router;
