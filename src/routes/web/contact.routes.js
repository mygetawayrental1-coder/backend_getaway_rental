const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/web/contact.web.controller');

router.post('/', ctrl.submit);

module.exports = router;
