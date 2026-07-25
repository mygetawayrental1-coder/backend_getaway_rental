const { Prisma } = require('@prisma/client');
const prisma = require('../config/database');
const { getPagination, formatPaginatedResponse, parseJsonField } = require('../utils/helpers');
const { verifyCaptcha } = require('./captcha.controller');
const { createTypedNotification, NOTIFICATION_TYPES } = require('../services/notification.service');
const { sendPaymentPendingEmail } = require('../services/email.service');
const icalService = require('../services/ical.service');
const {
    utcStartOfDay,
    calculateNights,
    calculateTotalAmount,
    validateDateRange,
    findStayConflicts,
    hasConflicts,
    conflictMessage,
    BLOCKING_BOOKING_STATUSES,
} = require('../utils/stayAvailability');

const BLOCKING_STATUSES = BLOCKING_BOOKING_STATUSES;

function parseDates(checkin, checkout) {
    return {
        checkinDate: utcStartOfDay(checkin),
        checkoutDate: utcStartOfDay(checkout),
    };
}

function bookingOverlapFilter(propertyId, checkinDate, checkoutDate, statuses = BLOCKING_STATUSES) {
    return {
        propertyId,
        status: { in: statuses },
        checkin: { lt: checkoutDate },
        checkout: { gt: checkinDate },
    };
}

async function resolveProperty(propertyId) {
    return prisma.property.findFirst({
        where: { OR: [{ id: propertyId }, { propertyId }] },
        include: {
            owner: {
                select: { id: true, email: true, firstName: true, lastName: true },
            },
        },
    });
}

async function findBookingByParam(id) {
    return prisma.booking.findFirst({
        where: { OR: [{ id }, { bookingId: id }] },
        include: {
            property: {
                select: {
                    id: true,
                    propertyId: true,
                    propertyName: true,
                    location: true,
                    state: true,
                    country: true,
                    images: true,
                    slug: true,
                    ownerId: true,
                    owner: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                            phoneNumber: true,
                        },
                    },
                },
            },
            payments: true,
        },
    });
}


function formatPayment(payment) {
    if (!payment) return null;
    return {
        ...payment,
        gatewayData: parseJsonField(payment.gatewayData),
    };
}

function formatPayments(payments) {
    if (!Array.isArray(payments)) return [];
    return payments.map(formatPayment);
}

function formatBookingRow(booking, { includeOwnerNotes = false } = {}) {
    const { property, payments, payment, ...rest } = booking;
    if (!includeOwnerNotes) {
        delete rest.ownerNotes;
    }
    const images = parseJsonField(property?.images);
    const paymentList = formatPayments(payments ?? (payment ? [payment] : []));
    const latestPayment = paymentList.length > 0 ? paymentList[paymentList.length - 1] : null;
    return {
        ...rest,
        property: property
            ? {
                  id: property.id,
                  propertyId: property.propertyId,
                  propertyName: property.propertyName,
                  location: property.location,
                  state: property.state,
                  country: property.country,
                  image: Array.isArray(images) ? images[0] || null : null,
                  slug: property.slug,
                  owner: property.owner,
              }
            : undefined,
        payments: paymentList,
        // Keep singular `payment` as latest record for older clients
        payment: latestPayment,
    };
}

function isPropertyOwner(booking, user) {
    return booking.property.ownerId === user.id;
}

function isBookingGuest(booking, user) {
    if (booking.guestClerkId && booking.guestClerkId === user.id) return true;
    if (
        booking.guestEmail &&
        user.email &&
        booking.guestEmail.trim().toLowerCase() === user.email.trim().toLowerCase()
    ) {
        return true;
    }
    return false;
}

async function notifyGuest(booking, property, type) {
    if (!booking.guestClerkId) return;
    await createTypedNotification({
        userId: booking.guestClerkId,
        type,
        data: {
            bookingId: booking.id,
            propertyId: property.id,
            propertyName: property.propertyName,
        },
        vars: { propertyName: property.propertyName },
    });
}

async function notifyOwner(ownerId, booking, property, type) {
    await createTypedNotification({
        userId: ownerId,
        type,
        data: {
            bookingId: booking.id,
            propertyId: property.id,
            propertyName: property.propertyName,
        },
        vars: { propertyName: property.propertyName },
    });
}

/**
 * POST /bookings/check-availability
 */
const checkAvailability = async (req, res) => {
    try {
        const { propertyId, checkin, checkout } = req.body;

        if (!propertyId || !checkin || !checkout) {
            return res.status(400).json({
                success: false,
                message: 'Property ID, check-in, and check-out dates are required.',
            });
        }

        const { checkinDate, checkoutDate } = parseDates(checkin, checkout);
        const dateError = validateDateRange(checkinDate, checkoutDate);
        if (dateError) {
            return res.status(400).json({ success: false, message: dateError });
        }

        const property = await resolveProperty(propertyId);
        if (!property) {
            return res.status(404).json({ success: false, message: 'Property not found.' });
        }

        const stay = await findStayConflicts(property.id, checkinDate, checkoutDate);
        const available = !hasConflicts(stay);
        const nights = calculateNights(checkinDate, checkoutDate);
        const nightlyRate = property.nightlyRate || property.minRate || 0;
        const weekendRate = property.weekendRate || null;
        const totalAmount = calculateTotalAmount(
            checkinDate,
            checkoutDate,
            nightlyRate,
            weekendRate,
        );

        res.json({
            success: true,
            available,
            message: available
                ? 'Property is available for booking.'
                : conflictMessage(stay),
            blockedDates: stay.blockedDates,
            conflicts: stay.bookings,
            icalConflicts: stay.icalEvents,
            acceptedRequestConflicts: stay.acceptedRequests,
            data: {
                propertyId: property.id,
                propertyName: property.propertyName,
                checkin: checkinDate,
                checkout: checkoutDate,
                nights,
                nightlyRate,
                weekendRate,
                totalAmount,
            },
        });
    } catch (error) {
        console.error('Check availability error:', error);
        res.status(500).json({ success: false, message: 'Failed to check availability.' });
    }
};

/**
 * POST /bookings/create
 */
const createBooking = async (req, res) => {
    try {
        const {
            propertyId,
            guestName,
            guestEmail,
            guestPhone,
            checkin,
            checkout,
            guests,
            notes,
            captchaId,
            captchaCode,
        } = req.body;

        if (!(await verifyCaptcha(captchaId, captchaCode))) {
            return res.status(400).json({ success: false, message: 'Invalid or expired security code.' });
        }

        if (!propertyId || !guestName || !guestEmail || !checkin || !checkout) {
            return res.status(400).json({
                success: false,
                message: 'Property ID, guest name, email, check-in, and check-out are required.',
            });
        }

        const { checkinDate, checkoutDate } = parseDates(checkin, checkout);
        const dateError = validateDateRange(checkinDate, checkoutDate);
        if (dateError) {
            return res.status(400).json({ success: false, message: dateError });
        }

        const property = await resolveProperty(propertyId);
        if (!property) {
            return res.status(404).json({ success: false, message: 'Property not found.' });
        }

        if (property.status !== 'Active') {
            return res.status(400).json({
                success: false,
                message: 'This listing is not available for booking.',
            });
        }

        const nights = calculateNights(checkinDate, checkoutDate);
        const nightlyRate = property.nightlyRate || property.minRate || 0;
        const weekendRate = property.weekendRate || null;
        const totalAmount = calculateTotalAmount(
            checkinDate,
            checkoutDate,
            nightlyRate,
            weekendRate,
        );

        const guestClerkId = req.user?.id || null;

        let booking;
        try {
            booking = await prisma.$transaction(async (tx) => {
                const stay = await findStayConflicts(
                    property.id,
                    checkinDate,
                    checkoutDate,
                    { tx },
                );
                if (hasConflicts(stay)) return { conflict: stay };

                const created = await tx.booking.create({
                    data: {
                        propertyId: property.id,
                        guestName,
                        guestEmail,
                        guestPhone: guestPhone || null,
                        guestClerkId,
                        checkin: checkinDate,
                        checkout: checkoutDate,
                        guests: parseInt(guests, 10) || 1,
                        nights,
                        nightlyRate,
                        weekendRate,
                        totalAmount,
                        notes: notes || null,
                        status: 'PENDING',
                    },
                    include: {
                        property: {
                            select: {
                                id: true,
                                propertyName: true,
                                location: true,
                                ownerId: true,
                            },
                        },
                    },
                });
                return { created };
            }, {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                maxWait: 5000,
                timeout: 10000,
            });
        } catch (error) {
            if (error.code === 'P2034') {
                return res.status(409).json({
                    success: false,
                    message: 'Could not create booking due to a conflict. Please try again.',
                });
            }
            throw error;
        }

        if (booking?.conflict) {
            return res.status(409).json({
                success: false,
                message: conflictMessage(booking.conflict),
                conflicts: booking.conflict,
            });
        }
        booking = booking?.created;
        if (!booking) {
            return res.status(409).json({
                success: false,
                message: 'Property is no longer available for the selected dates.',
            });
        }

        try {
            await notifyOwner(
                property.ownerId,
                booking,
                property,
                NOTIFICATION_TYPES.BOOKING_PENDING,
            );
        } catch (notifyErr) {
            console.error('Booking pending notification error:', notifyErr);
        }

        res.status(201).json({
            success: true,
            message: 'Booking request submitted. The owner will confirm shortly.',
            data: formatBookingRow({ ...booking, payments: [] }),
        });
    } catch (error) {
        console.error('Create booking error:', error);
        res.status(500).json({ success: false, message: 'Failed to create booking.' });
    }
};

/**
 * GET /bookings/owner/orders
 */
const getOwnerBookings = async (req, res) => {
    try {
        const { status, page, limit, sort } = req.query;
        const pagination = getPagination(page, limit);

        const where = {
            property: { ownerId: req.user.id },
        };
        if (status) where.status = String(status).toUpperCase();

        const orderBy =
            sort === 'checkin_asc'
                ? { checkin: 'asc' }
                : { createdAt: 'desc' };

        const [rows, total] = await Promise.all([
            prisma.booking.findMany({
                where,
                skip: pagination.skip,
                take: pagination.take,
                orderBy,
                include: {
                    property: {
                        select: {
                            propertyName: true,
                            location: true,
                            images: true,
                        },
                    },
                    payments: true,
                },
            }),
            prisma.booking.count({ where }),
        ]);

        res.json({
            success: true,
            ...formatPaginatedResponse(
                rows.map((b) => formatBookingRow(b, { includeOwnerNotes: true })),
                total,
                pagination.page,
                pagination.limit,
            ),
        });
    } catch (error) {
        console.error('Get owner bookings error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch bookings.' });
    }
};

/**
 * GET /bookings/admin/all
 */
const getAdminBookings = async (req, res) => {
    try {
        const { status, page, limit, sort } = req.query;
        const pagination = getPagination(page, limit);

        const where = {};
        if (status) where.status = String(status).toUpperCase();

        const orderBy =
            sort === 'checkin_asc'
                ? { checkin: 'asc' }
                : { createdAt: 'desc' };

        const [rows, total] = await Promise.all([
            prisma.booking.findMany({
                where,
                skip: pagination.skip,
                take: pagination.take,
                orderBy,
                include: {
                    property: {
                        select: {
                            propertyName: true,
                            location: true,
                            images: true,
                            owner: {
                                select: {
                                    id: true,
                                    email: true,
                                    firstName: true,
                                    lastName: true,
                                },
                            },
                        },
                    },
                    payments: true,
                },
            }),
            prisma.booking.count({ where }),
        ]);

        res.json({
            success: true,
            ...formatPaginatedResponse(
                rows.map((b) => formatBookingRow(b, { includeOwnerNotes: true })),
                total,
                pagination.page,
                pagination.limit,
            ),
        });
    } catch (error) {
        console.error('Get admin bookings error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch bookings.' });
    }
};

/**
 * GET /bookings/my
 */
const getGuestBookings = async (req, res) => {
    try {
        const { status, page, limit } = req.query;
        const pagination = getPagination(page, limit);

        const where = { guestClerkId: req.user.id };
        if (status) where.status = String(status).toUpperCase();

        const [rows, total] = await Promise.all([
            prisma.booking.findMany({
                where,
                skip: pagination.skip,
                take: pagination.take,
                orderBy: { checkin: 'desc' },
                include: {
                    property: {
                        select: {
                            propertyName: true,
                            location: true,
                            images: true,
                            slug: true,
                        },
                    },
                    payments: true,
                },
            }),
            prisma.booking.count({ where }),
        ]);

        res.json({
            success: true,
            ...formatPaginatedResponse(
                rows.map((b) => formatBookingRow(b)),
                total,
                pagination.page,
                pagination.limit,
            ),
        });
    } catch (error) {
        console.error('Get guest bookings error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch your bookings.' });
    }
};

/**
 * GET /bookings/:id
 */
const getBookingById = async (req, res) => {
    try {
        const booking = await findBookingByParam(req.params.id);

        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found.' });
        }

        const user = req.user;
        const allowed =
            user.role === 'ADMIN' ||
            isPropertyOwner(booking, user) ||
            isBookingGuest(booking, user);

        if (!allowed) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        res.json({
            success: true,
            data: formatBookingRow(booking, {
                includeOwnerNotes: isPropertyOwner(booking, user) || user.role === 'ADMIN',
            }),
        });
    } catch (error) {
        console.error('Get booking error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch booking.' });
    }
};

async function loadBookingForOwnerAction(id, user) {
    const booking = await findBookingByParam(id);
    if (!booking) {
        return { error: { status: 404, message: 'Booking not found.' } };
    }
    if (user.role !== 'ADMIN' && !isPropertyOwner(booking, user)) {
        return { error: { status: 403, message: 'Only the property owner can perform this action.' } };
    }
    return { booking };
}

/**
 * PATCH /bookings/:id/confirm
 */
const confirmBooking = async (req, res) => {
    try {
        const { booking, error } = await loadBookingForOwnerAction(req.params.id, req.user);
        if (error) return res.status(error.status).json({ success: false, message: error.message });

        if (booking.status !== 'PENDING') {
            return res.status(400).json({
                success: false,
                message: `Cannot confirm a booking with status ${booking.status}.`,
            });
        }

        let updated;
        try {
            updated = await prisma.$transaction(async (tx) => {
                const stay = await findStayConflicts(
                    booking.propertyId,
                    booking.checkin,
                    booking.checkout,
                    { excludeBookingId: booking.id, tx },
                );
                if (hasConflicts(stay)) {
                    return { conflict: stay };
                }

                const row = await tx.booking.update({
                    where: { id: booking.id },
                    data: { status: 'CONFIRMED', confirmedAt: new Date() },
                    include: { property: true, payments: true },
                });
                return { row };
            }, {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                maxWait: 5000,
                timeout: 10000,
            });
        } catch (error) {
            if (error.code === 'P2034') {
                return res.status(409).json({
                    success: false,
                    message: 'Could not confirm booking due to a conflict. Please try again.',
                });
            }
            throw error;
        }

        if (updated?.conflict) {
            return res.status(409).json({
                success: false,
                message: conflictMessage(updated.conflict),
                conflicts: updated.conflict,
            });
        }
        updated = updated?.row;

        try {
            await notifyGuest(updated, updated.property, NOTIFICATION_TYPES.BOOKING_CONFIRMED);

            const owner = await prisma.user.findUnique({ where: { id: updated.property.ownerId } });
            if (updated.guestEmail && owner) {
                await sendPaymentPendingEmail(updated.guestEmail, updated, owner);
            }
        } catch (notifyErr) {
            console.error('Booking confirmed notification error:', notifyErr);
        }

        try {
            await icalService.createEventForInternalBooking({
                id: updated.id,
                propertyId: updated.propertyId,
                checkin: updated.checkin,
                checkout: updated.checkout,
            });
        } catch (icalErr) {
            console.error('Failed to sync confirmed booking to iCal:', icalErr.message);
        }

        res.json({
            success: true,
            message: 'Booking confirmed.',
            data: formatBookingRow(updated, { includeOwnerNotes: true }),
        });
    } catch (error) {
        console.error('Confirm booking error:', error);
        res.status(500).json({ success: false, message: 'Failed to confirm booking.' });
    }
};

/**
 * PATCH /bookings/:id/ongoing
 */
const markOngoing = async (req, res) => {
    try {
        const { booking, error } = await loadBookingForOwnerAction(req.params.id, req.user);
        if (error) return res.status(error.status).json({ success: false, message: error.message });

        if (booking.status !== 'CONFIRMED') {
            return res.status(400).json({
                success: false,
                message: 'Only confirmed bookings can be marked as ongoing.',
            });
        }

        const updated = await prisma.booking.update({
            where: { id: booking.id },
            data: { status: 'ONGOING', checkedInAt: new Date() },
            include: { property: true, payments: true },
        });

        try {
            await notifyGuest(updated, updated.property, NOTIFICATION_TYPES.BOOKING_ONGOING);
        } catch (notifyErr) {
            console.error('Booking ongoing notification error:', notifyErr);
        }

        res.json({
            success: true,
            message: 'Guest checked in.',
            data: formatBookingRow(updated, { includeOwnerNotes: true }),
        });
    } catch (error) {
        console.error('Mark ongoing error:', error);
        res.status(500).json({ success: false, message: 'Failed to update booking.' });
    }
};

/**
 * PATCH /bookings/:id/complete
 */
const completeBooking = async (req, res) => {
    try {
        const { booking, error } = await loadBookingForOwnerAction(req.params.id, req.user);
        if (error) return res.status(error.status).json({ success: false, message: error.message });

        if (booking.status !== 'ONGOING') {
            return res.status(400).json({
                success: false,
                message: 'Only ongoing bookings can be marked complete.',
            });
        }

        const updated = await prisma.booking.update({
            where: { id: booking.id },
            data: { status: 'COMPLETED', completedAt: new Date() },
            include: { property: true, payments: true },
        });

        try {
            await notifyGuest(updated, updated.property, NOTIFICATION_TYPES.BOOKING_COMPLETED);
        } catch (notifyErr) {
            console.error('Booking completed notification error:', notifyErr);
        }

        res.json({
            success: true,
            message: 'Booking marked complete.',
            data: formatBookingRow(updated, { includeOwnerNotes: true }),
        });
    } catch (error) {
        console.error('Complete booking error:', error);
        res.status(500).json({ success: false, message: 'Failed to complete booking.' });
    }
};

/**
 * PATCH /bookings/:id/cancel
 */
const cancelBooking = async (req, res) => {
    try {
        const { reason } = req.body || {};
        const booking = await findBookingByParam(req.params.id);

        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found.' });
        }

        if (booking.status === 'CANCELLED') {
            return res.status(400).json({ success: false, message: 'Booking is already cancelled.' });
        }
        if (booking.status === 'COMPLETED') {
            return res.status(400).json({ success: false, message: 'Completed bookings cannot be cancelled.' });
        }

        const user = req.user;
        const isOwner = isPropertyOwner(booking, user);
        const isGuest = isBookingGuest(booking, user);
        const isAdmin = user.role === 'ADMIN';

        if (!isOwner && !isGuest && !isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.',
            });
        }

        let cancelledBy = 'guest';
        if (isAdmin) cancelledBy = 'admin';
        else if (isOwner && !isGuest) cancelledBy = 'owner';
        else if (isOwner && isGuest) cancelledBy = 'owner';

        const updated = await prisma.booking.update({
            where: { id: booking.id },
            data: {
                status: 'CANCELLED',
                cancelledAt: new Date(),
                cancelledBy,
                cancelReason: reason || null,
            },
            include: { property: true, payments: true },
        });

        try {
            if (cancelledBy === 'guest' || cancelledBy === 'admin') {
                await notifyOwner(
                    booking.property.ownerId,
                    updated,
                    updated.property,
                    NOTIFICATION_TYPES.BOOKING_CANCELLED,
                );
            }
            if ((cancelledBy === 'owner' || cancelledBy === 'admin') && updated.guestClerkId) {
                await notifyGuest(updated, updated.property, NOTIFICATION_TYPES.BOOKING_CANCELLED);
            }
        } catch (notifyErr) {
            console.error('Booking cancelled notification error:', notifyErr);
        }

        res.json({
            success: true,
            message: 'Booking cancelled.',
            data: formatBookingRow(updated, { includeOwnerNotes: isOwner || isAdmin }),
        });
    } catch (error) {
        console.error('Cancel booking error:', error);
        res.status(500).json({ success: false, message: 'Failed to cancel booking.' });
    }
};

/**
 * PATCH /bookings/:id/notes
 */
const updateOwnerNotes = async (req, res) => {
    try {
        const { ownerNotes } = req.body;
        const { booking, error } = await loadBookingForOwnerAction(req.params.id, req.user);
        if (error) return res.status(error.status).json({ success: false, message: error.message });

        const updated = await prisma.booking.update({
            where: { id: booking.id },
            data: { ownerNotes: ownerNotes != null ? String(ownerNotes) : null },
            include: { property: true, payments: true },
        });

        res.json({
            success: true,
            message: 'Owner notes updated.',
            data: formatBookingRow(updated, { includeOwnerNotes: true }),
        });
    } catch (error) {
        console.error('Update owner notes error:', error);
        res.status(500).json({ success: false, message: 'Failed to update notes.' });
    }
};

module.exports = {
    checkAvailability,
    createBooking,
    getOwnerBookings,
    getAdminBookings,
    getGuestBookings,
    getBookingById,
    confirmBooking,
    markOngoing,
    completeBooking,
    cancelBooking,
    updateOwnerNotes,
};
