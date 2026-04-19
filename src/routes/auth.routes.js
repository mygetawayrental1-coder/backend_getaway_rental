const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const router = express.Router();

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
});

const authStrictLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 25,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many attempts. Please try again later.' },
});

router.use(authLimiter);
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const { upload } = require('../config/storage');

// Validation middleware
const registerValidation = [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('firstName').trim().notEmpty().withMessage('First name is required'),
    body('lastName').trim().notEmpty().withMessage('Last name is required'),
];

const loginValidation = [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
];

// Handle Validation Errors
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: errors.array().map(err => err.msg).join(', '),
            errors: errors.array()
        });
    }
    next();
};

// Routes
router.post('/register', authStrictLimiter, upload.single('profilePic'), registerValidation, handleValidationErrors, authController.register);
router.post('/login', authStrictLimiter, loginValidation, handleValidationErrors, authController.login);
router.get('/verify-email/:token', authStrictLimiter, authController.verifyEmail);
router.post('/forgot-password', authStrictLimiter, body('email').isEmail(), handleValidationErrors, authController.forgotPassword);
router.post('/reset-password', authStrictLimiter, [
    body('password').isLength({ min: 6 }),
], handleValidationErrors, authController.resetPassword);
router.get('/me', authenticate, authController.getMe);
router.put('/edit-profile', authenticate, upload.single('profilePic'), authController.editProfile);
router.put('/change-password', authenticate, authController.changePassword);

module.exports = router;
