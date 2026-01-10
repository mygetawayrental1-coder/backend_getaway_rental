const express = require('express');
const router = express.Router();
const captchaController = require('../controllers/captcha.controller');

router.get('/create-captcha', captchaController.createCaptcha);
router.post('/regenerate', captchaController.regenerateCaptcha);
router.post('/validate', captchaController.validateCaptcha);

module.exports = router;
