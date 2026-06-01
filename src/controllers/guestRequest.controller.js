const prisma = require('../config/database');
const { getPagination, formatPaginatedResponse } = require('../utils/helpers');
const {
    sendGuestRequestNotification,
    sendGuestRequestConfirmationToGuest,
    sendGuestRequestAcceptedToGuest,
    sendGuestRequestRejectedToGuest,
} = require('../services/email.service');
const {
    createTypedNotification,
    NOTIFICATION_TYPES,
} = require('../services/notification.service');

function emailPayload(request, property) {
    return {
        propertyName: property.propertyName,
        fullName: request.fullName,
        email: request.email,
        phone: request.phone,
        checkin: request.checkin,
        checkout: request.checkout,
        guests: request.guests,
        message: request.message,
        ownerPhone: property.owner?.phoneNumber
            ? `${property.owner.countryCode || ''} ${property.owner.phoneNumber}`.trim()
            : null,
    };
}

// Create guest request (PUBLIC - no auth required)
const createGuestRequest = async (req, res) => {
    try {
        const { propertyId, fullName, email, phone, message, checkin, checkout, guests } =
            req.body;

        if (!propertyId || !fullName || !email) {
            return res.status(400).json({
                success: false,
                message: 'Property, full name, and email are required.',
            });
        }

        const property = await prisma.property.findFirst({
            where: { OR: [{ id: propertyId }, { propertyId }] },
            include: {
                owner: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        phoneNumber: true,
                        countryCode: true,
                    },
                },
            },
        });

        if (!property) {
            return res.status(404).json({
                success: false,
                message: 'Property not found.',
            });
        }

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
                status: 'NEW',
            },
            include: {
                property: {
                    select: { propertyName: true, location: true },
                },
            },
        });

        const mailData = emailPayload(guestRequest, property);

        // Respond immediately; emails/notifications run in the background (avoids SMTP timeouts blocking the client).
        void (async () => {
            try {
                await sendGuestRequestNotification(property.owner.email, mailData);
            } catch (emailError) {
                console.error('Owner email failed:', emailError.message);
            }

            try {
                await sendGuestRequestConfirmationToGuest(email, mailData);
            } catch (emailError) {
                console.error('Guest confirmation email failed:', emailError.message);
            }

            try {
                await createTypedNotification({
                    userId: property.owner.id,
                    type: NOTIFICATION_TYPES.GUEST_REQUEST_NEW,
                    data: {
                        guestRequestId: guestRequest.id,
                        propertyId: property.id,
                        propertyName: property.propertyName,
                    },
                    vars: {
                        propertyName: property.propertyName,
                        guestName: fullName,
                    },
                });
            } catch (notifyErr) {
                console.error('Owner dashboard notification failed:', notifyErr.message);
            }
        })();

        res.status(201).json({
            success: true,
            message:
                'Your request was submitted. Check your email for confirmation — the owner will respond soon.',
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

const getOwnerGuestRequests = async (req, res) => {
    try {
        const userId = req.user.id;
        const { page, limit, status, propertyId } = req.query;
        const pagination = getPagination(page, limit);

        const ownerProperties = await prisma.property.findMany({
            where: { ownerId: userId },
            select: { id: true },
        });

        const propertyIds = ownerProperties.map((p) => p.id);

        if (propertyIds.length === 0) {
            return res.json({
                success: true,
                data: [],
                total: 0,
                message: 'No properties found for this owner.',
            });
        }

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

const updateGuestRequestStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const userId = req.user.id;

        const validStatuses = [
            'NEW',
            'VIEWED',
            'CONTACTED',
            'ACCEPTED',
            'REJECTED',
            'CLOSED',
        ];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
            });
        }

        const request = await prisma.guestRequest.findUnique({
            where: { id },
            include: {
                property: {
                    select: {
                        propertyName: true,
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

        if (req.user.role !== 'ADMIN' && request.property.owner.id !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.',
            });
        }

        const previousStatus = request.status;
        const updated = await prisma.guestRequest.update({
            where: { id },
            data: { status },
        });

        const mailData = {
            propertyName: request.property.propertyName,
            fullName: request.fullName,
            email: request.email,
            phone: request.phone,
            checkin: request.checkin,
            checkout: request.checkout,
            guests: request.guests,
            message: request.message,
        };

        if (status === 'ACCEPTED' && previousStatus !== 'ACCEPTED') {
            try {
                await sendGuestRequestAcceptedToGuest(request.email, mailData);
            } catch (emailError) {
                console.error('Acceptance email failed:', emailError.message);
            }
        }

        if (status === 'REJECTED' && previousStatus !== 'REJECTED') {
            try {
                await sendGuestRequestRejectedToGuest(request.email, mailData);
            } catch (emailError) {
                console.error('Rejection email failed:', emailError.message);
            }
        }

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

const deleteGuestRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

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
