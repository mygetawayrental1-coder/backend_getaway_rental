const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/web/newsletter.web.controller');

router.post('/', ctrl.subscribe);

module.exports = router;
