const express = require('express');
const { handleClerk } = require('../controllers/webhook.controller');

const router = express.Router();

router.post('/clerk', express.raw({ type: 'application/json' }), handleClerk);

module.exports = router;
