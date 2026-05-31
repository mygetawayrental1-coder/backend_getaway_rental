const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
});

router.use(authLimiter);

const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const { upload } = require('../config/storage');

router.get('/me', authenticate, authController.getMe);
router.put('/edit-profile', authenticate, upload.single('profilePic'), authController.editProfile);

module.exports = router;
