const prisma = require('../config/database');
const { verifyCaptcha } = require('./captcha.controller');
const {
    sendCustomPricingOwnerConfirmation,
    sendCustomPricingAdminNotification
} = require('../services/email.service');

// Create custom pricing request
const createCustomPricingRequest = async (req, res) => {
    try {
        const { requestedPrice, numProperties, message, phone, captchaId, captchaCode, selectedPlanName } = req.body;
        const userId = req.user.id; // From authenticate middleware

        if (!verifyCaptcha(captchaId, captchaCode)) {
            console.warn(`[CustomPricing] Captcha verification failed for ID: ${captchaId}`);
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired captcha.',
            });
        }

        // Append selected plan to the message for easy admin viewing
        const finalMessage = selectedPlanName
            ? `[Target Plan: ${selectedPlanName}]\n\n${message || ''}`.trim()
            : message;

        const newRequest = await prisma.ownerRequest.create({
            data: {
                requestedPrice: parseFloat(requestedPrice),
                numProperties: parseInt(numProperties),
                message: finalMessage,
                phone,
                userId,
                type: 'CUSTOM_PRICING',
                status: 'PENDING'
            },
            include: {
                user: {
                    select: {
                        firstName: true,
                        lastName: true,
                        email: true
                    }
                }
            }
        });

        // Extract user data for emails
        const ownerEmail = newRequest.user.email;
        const ownerName = newRequest.user.firstName;

        // Dispatch Emails Asynchronously
        Promise.all([
            sendCustomPricingOwnerConfirmation(ownerEmail, ownerName, selectedPlanName),
            sendCustomPricingAdminNotification(
                ownerName,
                ownerEmail,
                selectedPlanName,
                requestedPrice,
                phone,
                message,
                numProperties
            )
        ]).catch(err => console.error("Error dispatching custom pricing emails:", err));

        res.status(201).json({
            success: true,
            message: 'Custom pricing request submitted successfully.',
            data: newRequest
        });
    } catch (error) {
        console.error('Create custom pricing request error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit request.'
        });
    }
};

// Create become-a-host application (web onboarding)
const createBecomeOwnerRequest = async (req, res) => {
    try {
        const { type, message, phone, numProperties } = req.body;
        const userId = req.user.id;

        if (type && type !== 'BECOME_OWNER') {
            return res.status(400).json({
                success: false,
                message: 'Invalid request type.',
            });
        }

        if (req.user.role === 'OWNER' || req.user.role === 'ADMIN') {
            return res.status(400).json({
                success: false,
                message: 'You already have owner access.',
            });
        }

        const num = parseInt(numProperties, 10);
        if (!num || Number.isNaN(num) || num < 1) {
            return res.status(400).json({
                success: false,
                message: 'Number of properties is required.',
            });
        }

        if (!phone || !String(phone).trim()) {
            return res.status(400).json({
                success: false,
                message: 'Phone number is required.',
            });
        }

        const existing = await prisma.ownerRequest.findFirst({
            where: { userId, type: 'BECOME_OWNER', status: 'PENDING' },
        });

        if (existing) {
            return res.status(409).json({
                success: false,
                message: 'You already have a pending owner application.',
            });
        }

        const newRequest = await prisma.ownerRequest.create({
            data: {
                userId,
                type: 'BECOME_OWNER',
                requestedPrice: 0,
                numProperties: num,
                message: message?.trim() || null,
                phone: String(phone).trim(),
                status: 'PENDING',
            },
        });

        res.status(201).json({
            success: true,
            message: 'Your owner application has been submitted. We will review it shortly.',
            data: newRequest,
        });
    } catch (error) {
        console.error('Create become owner request error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit application.',
        });
    }
};

// Get my requests (Owner)
const getMyRequests = async (req, res) => {
    try {
        const userId = req.user.id;
        const requests = await prisma.ownerRequest.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' }
        });

        res.json({
            success: true,
            data: requests
        });
    } catch (error) {
        console.error('Get my requests error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch your requests.'
        });
    }
};

// Get all requests (Admin only)
const getAllRequests = async (req, res) => {
    try {
        const requests = await prisma.ownerRequest.findMany({
            include: {
                user: {
                    select: {
                        firstName: true,
                        lastName: true,
                        email: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json({
            success: true,
            data: requests
        });
    } catch (error) {
        console.error('Get all requests error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch requests.'
        });
    }
};

// Update request status (Admin only)
const updateRequestStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const updated = await prisma.ownerRequest.update({
            where: { id },
            data: { status }
        });

        res.json({
            success: true,
            message: `Request status updated to ${status}.`,
            data: updated
        });
    } catch (error) {
        console.error('Update request status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update request status.'
        });
    }
};

module.exports = {
    createCustomPricingRequest,
    createBecomeOwnerRequest,
    getAllRequests,
    getMyRequests,
    updateRequestStatus
};
