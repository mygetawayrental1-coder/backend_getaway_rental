const prisma = require('../config/database');
const { getPagination, formatPaginatedResponse } = require('../utils/helpers');
const { verifyCaptcha } = require('./captcha.controller');
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

const BLOCKING_BOOKING_STATUSES = ['CONFIRMED', 'ONGOING'];
const PENDING_REQUEST_STATUSES = ['NEW', 'VIEWED', 'CONTACTED'];

function startOfDay(value) {
    const d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
}

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

/**
 * Returns conflicting bookings / accepted requests / owner-blocked nights
 * for the same property and overlapping stay.
 */
async function findStayConflicts(propertyId, checkin, checkout, { excludeRequestId } = {}) {
    if (!checkin || !checkout) {
        return { bookings: [], acceptedRequests: [], ownerBlocked: false };
    }

    const checkinDate = startOfDay(checkin);
    const checkoutDate = startOfDay(checkout);

    const [bookings, acceptedRequests, ownerBlock] = await Promise.all([
        prisma.booking.findMany({
            where: {
                propertyId,
                status: { in: BLOCKING_BOOKING_STATUSES },
                checkin: { lt: checkoutDate },
                checkout: { gt: checkinDate },
            },
            select: {
                id: true,
                bookingId: true,
                checkin: true,
                checkout: true,
                guestName: true,
                status: true,
            },
        }),
        prisma.guestRequest.findMany({
            where: {
                propertyId,
                status: 'ACCEPTED',
                ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
                AND: [
                    { checkin: { not: null } },
                    { checkout: { not: null } },
                    { checkin: { lt: checkoutDate } },
                    { checkout: { gt: checkinDate } },
                ],
            },
            select: {
                id: true,
                fullName: true,
                checkin: true,
                checkout: true,
            },
        }),
        prisma.propertyAvailability.findFirst({
            where: {
                propertyId,
                isAvailable: false,
                date: { gte: checkinDate, lt: checkoutDate },
            },
            select: { id: true, date: true },
        }),
    ]);

    return {
        bookings,
        acceptedRequests,
        ownerBlocked: Boolean(ownerBlock),
    };
}

function conflictMessage(conflicts) {
    if (conflicts.ownerBlocked) {
        return 'These dates include nights you blocked on the availability calendar.';
    }
    if (conflicts.bookings.length > 0) {
        return 'These dates overlap an existing confirmed booking. Only one stay can occupy the same nights.';
    }
    if (conflicts.acceptedRequests.length > 0) {
        return 'These dates overlap another accepted rent request. Decline the other request or choose different dates.';
    }
    return 'These dates are not available.';
}

// Create guest request (PUBLIC - no auth required)
const createGuestRequest = async (req, res) => {
    try {
        const { propertyId, fullName, email, phone, message, checkin, checkout, guests, captchaId, captchaCode } =
            req.body;

        if (!(await verifyCaptcha(captchaId, captchaCode))) {
            return res.status(400).json({ success: false, message: 'Invalid or expired security code.' });
        }

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

        if (checkin && checkout) {
            const conflicts = await findStayConflicts(property.id, checkin, checkout);
            if (
                conflicts.ownerBlocked ||
                conflicts.bookings.length > 0 ||
                conflicts.acceptedRequests.length > 0
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        'Those dates are already booked or blocked. Please choose different check-in / check-out dates.',
                    conflicts,
                });
            }
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
                        nightlyRate: true,
                        owner: {
                            select: {
                                id: true,
                                email: true,
                                firstName: true,
                                lastName: true,
                                paymentInstructions: true,
                            },
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

        const previousStatus = request.status;

        // Prevent double-booking: cannot accept overlapping stays.
        if (status === 'ACCEPTED' && previousStatus !== 'ACCEPTED') {
            if (!request.checkin || !request.checkout) {
                return res.status(400).json({
                    success: false,
                    message: 'This request has no stay dates, so it cannot be accepted as a booking.',
                });
            }

            const conflicts = await findStayConflicts(
                request.propertyId,
                request.checkin,
                request.checkout,
                { excludeRequestId: request.id },
            );

            if (
                conflicts.ownerBlocked ||
                conflicts.bookings.length > 0 ||
                conflicts.acceptedRequests.length > 0
            ) {
                return res.status(409).json({
                    success: false,
                    message: conflictMessage(conflicts),
                    conflicts,
                });
            }
        }

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
            const checkin = startOfDay(request.checkin);
            const checkout = startOfDay(request.checkout);
            const nights = Math.max(
                1,
                Math.ceil((checkout - checkin) / (1000 * 60 * 60 * 24)),
            );
            const nightlyRate = request.property.nightlyRate || 0;

            try {
                // Re-check inside create path so two accepts can't race.
                const raceConflicts = await findStayConflicts(
                    request.propertyId,
                    checkin,
                    checkout,
                    { excludeRequestId: request.id },
                );
                if (
                    raceConflicts.ownerBlocked ||
                    raceConflicts.bookings.length > 0 ||
                    raceConflicts.acceptedRequests.length > 0
                ) {
                    await prisma.guestRequest.update({
                        where: { id },
                        data: { status: previousStatus },
                    });
                    return res.status(409).json({
                        success: false,
                        message: conflictMessage(raceConflicts),
                        conflicts: raceConflicts,
                    });
                }

                await prisma.booking.create({
                    data: {
                        propertyId: request.propertyId,
                        guestName: request.fullName,
                        guestEmail: request.email,
                        guestPhone: request.phone,
                        checkin,
                        checkout,
                        guests: request.guests,
                        nights,
                        nightlyRate,
                        totalAmount: nights * nightlyRate,
                        status: 'CONFIRMED',
                    },
                });
            } catch (bookingErr) {
                console.error('Failed to create booking from guest request:', bookingErr.message);
                await prisma.guestRequest.update({
                    where: { id },
                    data: { status: previousStatus },
                });
                return res.status(500).json({
                    success: false,
                    message: 'Could not block these dates as a booking. Request was not accepted.',
                });
            }

            // Auto-decline other pending requests that overlap these nights.
            const overlappingPending = await prisma.guestRequest.findMany({
                where: {
                    propertyId: request.propertyId,
                    id: { not: request.id },
                    status: { in: PENDING_REQUEST_STATUSES },
                    AND: [
                        { checkin: { not: null } },
                        { checkout: { not: null } },
                        { checkin: { lt: checkout } },
                        { checkout: { gt: checkin } },
                    ],
                },
            });

            if (overlappingPending.length > 0) {
                await prisma.guestRequest.updateMany({
                    where: { id: { in: overlappingPending.map((r) => r.id) } },
                    data: { status: 'REJECTED' },
                });

                for (const pending of overlappingPending) {
                    try {
                        await sendGuestRequestRejectedToGuest(pending.email, {
                            propertyName: request.property.propertyName,
                            fullName: pending.fullName,
                            email: pending.email,
                            phone: pending.phone,
                            checkin: pending.checkin,
                            checkout: pending.checkout,
                            guests: pending.guests,
                            message: pending.message,
                        });
                    } catch (emailError) {
                        console.error('Auto-reject email failed:', emailError.message);
                    }
                }
            }

            try {
                await sendGuestRequestAcceptedToGuest(
                    request.email,
                    mailData,
                    request.property.owner,
                );
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
            message:
                status === 'ACCEPTED'
                    ? 'Request accepted. Overlapping pending requests were declined automatically.'
                    : 'Status updated successfully.',
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
