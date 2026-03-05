const bcrypt = require('bcryptjs');
const prisma = require('../config/database');
const { generateToken, generateRandomToken, generateResetToken } = require('../services/token.service');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/email.service');

// Register new user
const register = async (req, res) => {
    try {
        const { email, password, firstName, lastName, countryCode, phoneNumber, address, role } = req.body;

        // Check if user exists
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Email already registered.',
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 12);

        // Generate email verification token (24 hours expiry)
        const verifyToken = generateToken({ email }, '24h');

        // Determine role (default to OWNER for registration, END_USER for guests)
        const userRole = role === 'END_USER' ? 'END_USER' : 'OWNER';

        // Create user
        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                firstName,
                lastName,
                countryCode,
                phoneNumber,
                address,
                role: userRole,
                verifyToken,
                profilePic: req.file ? `/uploads/${req.file.filename}` : null,
            },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                createdAt: true,
            },
        });

        // Send verification email
        try {
            await sendVerificationEmail(email, verifyToken);
        } catch (emailError) {
            console.error('Failed to send verification email:', emailError);
        }

        // Generate JWT
        const token = generateToken({ userId: user.id, email: user.email, role: user.role });

        res.status(201).json({
            success: true,
            message: 'Registration successful. Please verify your email.',
            data: {
                ...user,
                token
            },
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({
            success: false,
            message: 'Registration failed.',
        });
    }
};

// Login user
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password.',
            });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password.',
            });
        }

        // Generate JWT
        const token = generateToken({ userId: user.id, email: user.email, role: user.role });

        res.json({
            success: true,
            message: 'Login successful.',
            data: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                countryCode: user.countryCode,
                phoneNumber: user.phoneNumber,
                address: user.address,
                profilePic: user.profilePic,
                role: user.role,
                emailVerified: user.emailVerified,
                token,
            },
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Login failed.',
        });
    }
};

// Verify email
const verifyEmail = async (req, res) => {
    try {
        const { token } = req.params;

        const decoded = require('../services/token.service').verifyToken(token);

        if (!decoded || !decoded.email) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired verification token.',
            });
        }

        const user = await prisma.user.findFirst({ where: { email: decoded.email, verifyToken: token } });
        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'Invalid verification token.',
            });
        }

        await prisma.user.update({
            where: { id: user.id },
            data: {
                emailVerified: true,
                verifyToken: null,
            },
        });

        res.json({
            success: true,
            message: 'Email verified successfully.',
        });
    } catch (error) {
        console.error('Verify email error:', error);
        res.status(500).json({
            success: false,
            message: 'Email verification failed.',
        });
    }
};

// Forgot password - send reset link
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            // Don't reveal if email exists
            return res.json({
                success: true,
                message: 'If the email exists, a password reset link will be sent.',
            });
        }

        // Generate 6-digit OTP for mobile compatibility
        const token = Math.floor(100000 + Math.random() * 900000).toString();
        const expiry = new Date(Date.now() + 3600000); // 1 hour

        await prisma.user.update({
            where: { id: user.id },
            data: {
                resetToken: token,
                resetTokenExpiry: expiry,
            },
        });

        await sendPasswordResetEmail(email, token);

        res.json({
            success: true,
            message: 'If the email exists, a password reset link/OTP will be sent.',
        });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to process request.',
        });
    }
};

// Reset password
const resetPassword = async (req, res) => {
    try {
        const { token, otp, email, password } = req.body;
        const resetCode = token || otp;

        const where = {
            resetToken: resetCode,
            resetTokenExpiry: { gt: new Date() },
        };

        if (email) {
            where.email = email;
        }

        const user = await prisma.user.findFirst({
            where,
        });

        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired reset token.',
            });
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                resetToken: null,
                resetTokenExpiry: null,
            },
        });

        res.json({
            success: true,
            message: 'Password reset successful. You can now login.',
        });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({
            success: false,
            message: 'Password reset failed.',
        });
    }
};

// Get current user profile
const getMe = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                countryCode: true,
                phoneNumber: true,
                address: true,
                profilePic: true,
                role: true,
                emailVerified: true,
                createdAt: true,
            },
        });

        res.json({
            success: true,
            data: user,
        });
    } catch (error) {
        console.error('Get me error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch profile.',
        });
    }
};

// Update current user profile (Mobile/Web)
const editProfile = async (req, res) => {
    try {
        const { email } = req.query; // Mobile uses query param
        const userId = req.user.id;
        const { firstName, lastName, countryCode, phoneNumber, address, profilePic, about } = req.body;

        // Ensure user is updating their own profile or is admin
        const targetUser = email ? await prisma.user.findUnique({ where: { email } }) : null;

        if (email && !targetUser) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const idToUpdate = targetUser ? targetUser.id : userId;

        if (req.user.role !== 'ADMIN' && idToUpdate !== userId) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const updateData = {};
        if (firstName) updateData.firstName = firstName;
        if (lastName) updateData.lastName = lastName;
        if (countryCode !== undefined) updateData.countryCode = countryCode;
        if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
        if (address !== undefined) updateData.address = address;
        if (req.file) {
            updateData.profilePic = `/uploads/${req.file.filename}`;
        } else if (profilePic !== undefined) {
            updateData.profilePic = profilePic;
        }
        if (about !== undefined) updateData.about = about;

        const user = await prisma.user.update({
            where: { id: idToUpdate },
            data: updateData,
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                countryCode: true,
                phoneNumber: true,
                address: true,
                profilePic: true,
                role: true,
                emailVerified: true,
            },
        });

        res.json({
            success: true,
            message: 'Profile updated successfully.',
            data: user,
        });
    } catch (error) {
        console.error('Edit profile error:', error);
        res.status(500).json({ success: false, message: 'Failed to update profile.' });
    }
};

// Change password
const changePassword = async (req, res) => {
    try {
        const { email } = req.query;
        const { currentPassword, newPassword } = req.body;
        const userId = req.user.id;

        const targetUser = email ? await prisma.user.findUnique({ where: { email } }) : await prisma.user.findUnique({ where: { id: userId } });

        if (!targetUser) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        // Check ownership
        if (req.user.role !== 'ADMIN' && targetUser.id !== userId) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, targetUser.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: 'Incorrect current password.' });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 12);

        await prisma.user.update({
            where: { id: targetUser.id },
            data: { password: hashedPassword },
        });

        res.json({
            success: true,
            message: 'Password changed successfully.',
        });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ success: false, message: 'Failed to change password.' });
    }
};

module.exports = {
    register,
    login,
    verifyEmail,
    forgotPassword,
    resetPassword,
    getMe,
    editProfile,
    changePassword,
};
