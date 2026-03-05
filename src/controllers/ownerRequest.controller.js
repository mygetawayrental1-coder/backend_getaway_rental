const prisma = require('../config/database');

// Create custom pricing request
const createCustomPricingRequest = async (req, res) => {
    try {
        const { requestedPrice, numProperties, message, phone } = req.body;
        const userId = req.user.id; // From authenticate middleware

        const newRequest = await prisma.ownerRequest.create({
            data: {
                requestedPrice: parseFloat(requestedPrice),
                numProperties: parseInt(numProperties),
                message,
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
    getAllRequests,
    getMyRequests,
    updateRequestStatus
};
