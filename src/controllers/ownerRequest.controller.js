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

// Create custom pricing request for GUEST (no auth required) — saved for Admin Custom Pricing
const createGuestCustomPricingRequest = async (req, res) => {
    try {
        const { requestedPrice, numProperties, message, phone, captchaId, captchaCode, selectedPlanName, name, email } = req.body;

        const guestName = String(name || '').trim();
        const guestEmail = String(email || '').trim().toLowerCase();

        if (!guestName || !guestEmail) {
            return res.status(400).json({ success: false, message: 'Name and email are required.' });
        }

        if (!requestedPrice || !numProperties || !phone || !selectedPlanName) {
            return res.status(400).json({ success: false, message: 'Please fill in all required fields.' });
        }

        if (!verifyCaptcha(captchaId, captchaCode)) {
            console.warn(`[GuestCustomPricing] Captcha verification failed for ID: ${captchaId}`);
            return res.status(400).json({ success: false, message: 'Invalid or expired captcha.' });
        }

        const finalMessage = selectedPlanName
            ? `[Target Plan: ${selectedPlanName}]\n\n${message || ''}`.trim()
            : message;

        // Link to an existing account if this email already registered; otherwise store as guest.
        const existingUser = await prisma.user.findFirst({
            where: { email: { equals: guestEmail, mode: 'insensitive' } },
            select: { id: true, firstName: true, email: true },
        });

        const newRequest = await prisma.ownerRequest.create({
            data: {
                userId: existingUser?.id || null,
                guestName: existingUser ? null : guestName,
                guestEmail: existingUser ? null : guestEmail,
                requestedPrice: parseFloat(requestedPrice),
                numProperties: parseInt(numProperties, 10),
                message: finalMessage,
                phone: String(phone).trim(),
                type: 'CUSTOM_PRICING',
                status: 'PENDING',
            },
            include: {
                user: {
                    select: { firstName: true, lastName: true, email: true },
                },
            },
        });

        Promise.all([
            sendCustomPricingOwnerConfirmation(guestEmail, guestName, selectedPlanName),
            sendCustomPricingAdminNotification(
                guestName,
                guestEmail,
                selectedPlanName,
                requestedPrice,
                phone,
                message,
                numProperties
            ),
        ]).catch((err) => console.error('[GuestCustomPricing] Email error:', err));

        res.status(201).json({
            success: true,
            message: 'Your custom pricing request has been submitted. We will be in touch shortly.',
            data: newRequest,
        });
    } catch (error) {
        console.error('Guest custom pricing request error:', error);
        res.status(500).json({ success: false, message: 'Failed to submit request.' });
    }
};

// Create become-a-host application (web onboarding)
const createBecomeOwnerRequest = async (req, res) => {
    try {
        const { type, message, phone, numProperties, captchaId, captchaCode } = req.body;
        const userId = req.user.id;

        if (!verifyCaptcha(captchaId, captchaCode)) {
            return res.status(400).json({ success: false, message: 'Invalid or expired security code.' });
        }

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
        const { type } = req.query;
        const where = {};
        if (type) where.type = String(type).toUpperCase();

        const requests = await prisma.ownerRequest.findMany({
            where,
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

/** DELETE /owner-requests/:id — Admin only */
const deleteRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await prisma.ownerRequest.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Request not found.' });
        }
        await prisma.ownerRequest.delete({ where: { id } });
        res.json({ success: true, message: 'Request deleted.' });
    } catch (error) {
        console.error('Delete owner request error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete request.' });
    }
};

module.exports = {
    createCustomPricingRequest,
    createGuestCustomPricingRequest,
    createBecomeOwnerRequest,
    getAllRequests,
    getMyRequests,
    updateRequestStatus,
    deleteRequest,
};
