const prisma = require('../config/database');

const BLOCKING_BOOKING_STATUSES = ['CONFIRMED', 'ONGOING'];

/** Calendar-day in UTC (avoids IST/UTC off-by-one on date-only strings). */
function utcStartOfDay(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function calculateNights(checkinDate, checkoutDate) {
    return Math.ceil((checkoutDate - checkinDate) / (1000 * 60 * 60 * 24));
}

/** Nightly + weekend rates for each night [checkin, checkout). */
function calculateTotalAmount(checkinDate, checkoutDate, nightlyRate, weekendRate) {
    let total = 0;
    const cur = new Date(checkinDate);
    const end = new Date(checkoutDate);
    while (cur < end) {
        const day = cur.getUTCDay();
        const isWeekend = day === 0 || day === 6;
        const rate =
            isWeekend && weekendRate != null && weekendRate > 0
                ? weekendRate
                : nightlyRate;
        total += rate;
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return total;
}

function validateDateRange(checkinDate, checkoutDate) {
    if (!checkinDate || !checkoutDate) {
        return 'Check-in and check-out dates are required.';
    }
    if (checkinDate >= checkoutDate) {
        return 'Check-out date must be after check-in date.';
    }
    const today = utcStartOfDay(new Date());
    if (checkinDate < today) {
        return 'Check-in date cannot be in the past.';
    }
    return null;
}

/**
 * Full stay conflict check: confirmed/ongoing bookings, accepted rent requests,
 * owner-blocked nights, and imported/internal iCal events.
 */
async function findStayConflicts(
    propertyId,
    checkin,
    checkout,
    { excludeBookingId, excludeRequestId, tx } = {},
) {
    const db = tx || prisma;
    const checkinDate = utcStartOfDay(checkin);
    const checkoutDate = utcStartOfDay(checkout);

    if (!checkinDate || !checkoutDate) {
        return {
            checkinDate,
            checkoutDate,
            bookings: [],
            acceptedRequests: [],
            icalEvents: [],
            ownerBlocked: false,
            blockedDates: [],
        };
    }

    const [bookings, acceptedRequests, ownerBlocks, icalEvents] = await Promise.all([
        db.booking.findMany({
            where: {
                propertyId,
                status: { in: BLOCKING_BOOKING_STATUSES },
                ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
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
        db.guestRequest.findMany({
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
                status: true,
            },
        }),
        db.propertyAvailability.findMany({
            where: {
                propertyId,
                isAvailable: false,
                date: { gte: checkinDate, lt: checkoutDate },
            },
            orderBy: { date: 'asc' },
        }),
        db.icalEvent.findMany({
            where: {
                propertyId,
                dtStart: { lt: checkoutDate },
                dtEnd: { gt: checkinDate },
            },
            select: {
                id: true,
                uid: true,
                dtStart: true,
                dtEnd: true,
                source: true,
                summary: true,
            },
        }),
    ]);

    return {
        checkinDate,
        checkoutDate,
        bookings,
        acceptedRequests,
        icalEvents,
        ownerBlocked: ownerBlocks.length > 0,
        blockedDates: ownerBlocks.map((r) => ({ date: r.date, note: r.note })),
    };
}

function hasConflicts(conflicts) {
    return (
        conflicts.ownerBlocked ||
        (conflicts.bookings && conflicts.bookings.length > 0) ||
        (conflicts.acceptedRequests && conflicts.acceptedRequests.length > 0) ||
        (conflicts.icalEvents && conflicts.icalEvents.length > 0)
    );
}

function conflictMessage(conflicts) {
    if (conflicts.ownerBlocked) {
        return 'Selected dates include nights the owner has blocked.';
    }
    if (conflicts.bookings?.length) {
        return 'Selected dates overlap an existing confirmed booking.';
    }
    if (conflicts.acceptedRequests?.length) {
        return 'Selected dates overlap an accepted rent request.';
    }
    if (conflicts.icalEvents?.length) {
        return 'Selected dates overlap a synced calendar (iCal) block.';
    }
    return 'Property is not available for the selected dates.';
}

/**
 * Property IDs that are unavailable for [check_in, check_out).
 * Used by website search.
 */
async function propertyIdsBlockedForRange(checkIn, checkOut) {
    const start = utcStartOfDay(checkIn);
    const end = utcStartOfDay(checkOut);
    if (!start || !end || !(start < end)) return [];

    const [bookings, accepted, ownerBlocks, ical] = await Promise.all([
        prisma.booking.findMany({
            where: {
                status: { in: BLOCKING_BOOKING_STATUSES },
                checkin: { lt: end },
                checkout: { gt: start },
            },
            select: { propertyId: true },
        }),
        prisma.guestRequest.findMany({
            where: {
                status: 'ACCEPTED',
                AND: [
                    { checkin: { not: null } },
                    { checkout: { not: null } },
                    { checkin: { lt: end } },
                    { checkout: { gt: start } },
                ],
            },
            select: { propertyId: true },
        }),
        prisma.propertyAvailability.findMany({
            where: {
                isAvailable: false,
                date: { gte: start, lt: end },
            },
            select: { propertyId: true },
        }),
        prisma.icalEvent.findMany({
            where: {
                dtStart: { lt: end },
                dtEnd: { gt: start },
            },
            select: { propertyId: true },
        }),
    ]);

    return [
        ...new Set([
            ...bookings.map((b) => b.propertyId),
            ...accepted.map((r) => r.propertyId),
            ...ownerBlocks.map((b) => b.propertyId),
            ...ical.map((e) => e.propertyId),
        ]),
    ];
}

module.exports = {
    BLOCKING_BOOKING_STATUSES,
    utcStartOfDay,
    calculateNights,
    calculateTotalAmount,
    validateDateRange,
    findStayConflicts,
    hasConflicts,
    conflictMessage,
    propertyIdsBlockedForRange,
};
