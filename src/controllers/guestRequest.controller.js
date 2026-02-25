const prisma = require('../config/database');
const { getPagination, formatPaginatedResponse } = require('../utils/helpers');

// Create guest request (PUBLIC - no auth required)
const createGuestRequest = async (req, res) => {
    try {
        const { propertyId, fullName, email, phone, message, checkin, checkout, guests } = req.body;

        // Validate required fields
        if (!propertyId || !fullName || !email) {
            return res.status(400).json({
                success: false,
                message: 'Property ID, full name, and email are required.',
            });
        }

        // Check if property exists
        const property = await prisma.property.findFirst({
            where: { OR: [{ id: propertyId }, { propertyId }] },
            include: {
                owner: {
                    select: { id: true, email: true, firstName: true },
                },
            },
        });

        if (!property) {
            return res.status(404).json({
                success: false,
                message: 'Property not found.',
            });
        }

        // Create the guest request
        const guestRequest = await prisma.guestRequest.create({
            data: {
                propertyId: property.id,
                fullName,
                email,
                phone,
                message,
                checkin: checkin ? new Date(checkin) : null,
                checkout: checkout ? new Date(checkout) : null,
                guests: guests || 1,
            },
            include: {
                property: {
                    select: { propertyName: true, location: true },
                },
            },
        });

        // TODO: Send notification email to property owner
        console.log(`New guest request for property ${property.propertyName} - Owner: ${property.owner.email}`);

        res.status(201).json({
            success: true,
            message: 'Your request has been submitted successfully. The property owner will contact you soon.',
            data: guestRequest,
        });
    } catch (error) {
        console.error('Create guest request error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit request.',
        });
    }
};

// Get guest requests for a property owner (AUTH required)
const getOwnerGuestRequests = async (req, res) => {
    try {
        const userId = req.user.id;
        const { page, limit, status, propertyId } = req.query;
        const pagination = getPagination(page, limit);

        // Get owner's properties first
        const ownerProperties = await prisma.property.findMany({
            where: { ownerId: userId },
            select: { id: true },
        });

        const propertyIds = ownerProperties.map(p => p.id);

        if (propertyIds.length === 0) {
            return res.json({
                success: true,
                data: [],
                total: 0,
                message: 'No properties found for this owner.',
            });
        }

        // Build where clause
        const where = {
            propertyId: { in: propertyIds },
        };

        if (status) {
            where.status = status;
        }

        if (propertyId && propertyIds.includes(propertyId)) {
            where.propertyId = propertyId;
        }

        const [requests, total] = await Promise.all([
            prisma.guestRequest.findMany({
                where,
                skip: pagination.skip,
                take: pagination.take,
                orderBy: { createdAt: 'desc' },
                include: {
                    property: {
                        select: { propertyName: true, location: true, images: true },
                    },
                },
            }),
            prisma.guestRequest.count({ where }),
        ]);

        res.json({
            success: true,
            ...formatPaginatedResponse(requests, total, pagination.page, pagination.limit),
        });
    } catch (error) {
        console.error('Get owner guest requests error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch guest requests.',
        });
    }
};

// Get single guest request (AUTH required)
const getGuestRequestById = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const request = await prisma.guestRequest.findUnique({
            where: { id },
            include: {
                property: {
                    include: {
                        owner: {
                            select: { id: true },
                        },
                    },
                },
            },
        });

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'Guest request not found.',
            });
        }

        // Check authorization (must be property owner or admin)
        if (req.user.role !== 'ADMIN' && request.property.owner.id !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.',
            });
        }

        res.json({
            success: true,
            data: request,
        });
    } catch (error) {
        console.error('Get guest request error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch guest request.',
        });
    }
};

// Update guest request status (AUTH required - owner only)
const updateGuestRequestStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const userId = req.user.id;

        const validStatuses = ['NEW', 'VIEWED', 'CONTACTED', 'CLOSED'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
            });
        }

        // Find the request
        const request = await prisma.guestRequest.findUnique({
            where: { id },
            include: {
                property: {
                    include: {
                        owner: { select: { id: true } },
                    },
                },
            },
        });

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'Guest request not found.',
            });
        }

        // Check authorization
        if (req.user.role !== 'ADMIN' && request.property.owner.id !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.',
            });
        }

        // Update status
        const updated = await prisma.guestRequest.update({
            where: { id },
            data: { status },
        });

        res.json({
            success: true,
            message: 'Status updated successfully.',
            data: updated,
        });
    } catch (error) {
        console.error('Update guest request status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update status.',
        });
    }
};

// Delete guest request (AUTH required - owner or admin only)
const deleteGuestRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // Find the request
        const request = await prisma.guestRequest.findUnique({
            where: { id },
            include: {
                property: {
                    include: {
                        owner: { select: { id: true } },
                    },
                },
            },
        });

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'Guest request not found.',
            });
        }

        // Check authorization
        if (req.user.role !== 'ADMIN' && request.property.owner.id !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.',
            });
        }

        await prisma.guestRequest.delete({ where: { id } });

        res.json({
            success: true,
            message: 'Guest request deleted successfully.',
        });
    } catch (error) {
        console.error('Delete guest request error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete guest request.',
        });
    }
};

module.exports = {
    createGuestRequest,
    getOwnerGuestRequests,
    getGuestRequestById,
    updateGuestRequestStatus,
    deleteGuestRequest,
};
