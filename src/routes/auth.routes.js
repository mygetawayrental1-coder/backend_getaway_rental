const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const { uploadSingle } = require('../middleware/upload');

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

// Routes
router.post('/register', uploadSingle, registerValidation, authController.register);
router.post('/login', loginValidation, authController.login);
router.get('/verify-email/:token', authController.verifyEmail);
router.post('/forgot-password', body('email').isEmail(), authController.forgotPassword);
router.post('/reset-password', [
    body('password').isLength({ min: 6 }),
], authController.resetPassword);
router.get('/me', authenticate, authController.getMe);
router.put('/edit-profile', authenticate, uploadSingle, authController.editProfile);
router.put('/change-password', authenticate, authController.changePassword);

module.exports = router;
