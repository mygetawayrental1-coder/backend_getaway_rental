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
    return calculateStayQuote({
        checkin: checkinDate,
        checkout: checkoutDate,
        nightlyRate,
        weekendRate,
        seasons: [],
    }).subtotal;
}

function toUtcDay(value) {
    if (!value) return null;
    if (value instanceof Date) return utcStartOfDay(value);
    const s = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const [y, m, d] = s.slice(0, 10).split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d));
    }
    return utcStartOfDay(value);
}

/** Inclusive season coverage: startDate <= night <= endDate (UTC days). */
function findSeasonForNight(night, seasons) {
    if (!Array.isArray(seasons) || !seasons.length) return null;
    for (const s of seasons) {
        if (s && s.isActive === false) continue;
        const start = toUtcDay(s.startDate);
        const end = toUtcDay(s.endDate);
        if (!start || !end) continue;
        if (night >= start && night <= end) return s;
    }
    return null;
}

/**
 * Per-night quote with seasonal overrides.
 * @returns {{ nights: number, subtotal: number, nightlyBreakdown: Array<{ date: string, rate: number, seasonName: string|null, isWeekend: boolean }> }}
 */
function calculateStayQuote({
    checkin,
    checkout,
    nightlyRate = 0,
    weekendRate = null,
    seasons = [],
} = {}) {
    const start = toUtcDay(checkin);
    const end = toUtcDay(checkout);
    const breakdown = [];
    if (!start || !end || !(start < end)) {
        return { nights: 0, subtotal: 0, nightlyBreakdown: breakdown };
    }

    const baseNightly = Number(nightlyRate) || 0;
    const baseWeekend =
        weekendRate != null && Number(weekendRate) > 0 ? Number(weekendRate) : null;

    const activeSeasons = (Array.isArray(seasons) ? seasons : []).filter(
        (s) => s && s.isActive !== false,
    );

    let subtotal = 0;
    const cur = new Date(start);
    while (cur < end) {
        const day = cur.getUTCDay();
        const isWeekend = day === 0 || day === 6;
        const season = findSeasonForNight(cur, activeSeasons);
        let rate = baseNightly;
        let seasonName = null;
        if (season) {
            seasonName = season.name || 'Season';
            const sNight = Number(season.nightlyRate) || baseNightly;
            const sWeekend =
                season.weekendRate != null && Number(season.weekendRate) > 0
                    ? Number(season.weekendRate)
                    : null;
            rate = isWeekend && sWeekend != null ? sWeekend : sNight;
            // If season has no weekend rate, still allow property weekend rate
            if (isWeekend && sWeekend == null && baseWeekend != null) {
                rate = baseWeekend;
            }
        } else if (isWeekend && baseWeekend != null) {
            rate = baseWeekend;
        }

        const iso = `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}-${String(cur.getUTCDate()).padStart(2, '0')}`;
        breakdown.push({ date: iso, rate, seasonName, isWeekend });
        subtotal += rate;
        cur.setUTCDate(cur.getUTCDate() + 1);
    }

    return {
        nights: breakdown.length,
        subtotal,
        nightlyBreakdown: breakdown,
    };
}

/** Parse seasonalPrices from request body (JSON string or array). */
function parseSeasonalPricesInput(raw) {
    let list = raw;
    if (typeof raw === 'string') {
        try {
            list = JSON.parse(raw);
        } catch {
            return { error: 'Invalid seasonalPrices JSON.' };
        }
    }
    if (list == null) return { seasons: null };
    if (!Array.isArray(list)) return { error: 'seasonalPrices must be an array.' };

    const seasons = [];
    for (let i = 0; i < list.length; i++) {
        const row = list[i] || {};
        const start = toUtcDay(row.startDate);
        const end = toUtcDay(row.endDate);
        const nightly = parseInt(row.nightlyRate, 10);
        if (!start || !end) {
            return { error: `Season ${i + 1}: start and end dates are required.` };
        }
        if (start > end) {
            return { error: `Season ${i + 1}: end date must be on or after start date.` };
        }
        if (!Number.isFinite(nightly) || nightly <= 0) {
            return { error: `Season ${i + 1}: nightly rate must be greater than 0.` };
        }
        let weekend = null;
        if (row.weekendRate != null && String(row.weekendRate).trim() !== '') {
            weekend = parseInt(row.weekendRate, 10);
            if (!Number.isFinite(weekend) || weekend < 0) {
                return { error: `Season ${i + 1}: weekend rate is invalid.` };
            }
            if (weekend === 0) weekend = null;
        }
        seasons.push({
            name: row.name != null && String(row.name).trim() ? String(row.name).trim() : null,
            startDate: start,
            endDate: end,
            nightlyRate: nightly,
            weekendRate: weekend,
            isActive: row.isActive !== false && row.isActive !== 'false',
        });
    }

    // Overlap check among active seasons
    const active = seasons.filter((s) => s.isActive);
    for (let i = 0; i < active.length; i++) {
        for (let j = i + 1; j < active.length; j++) {
            const a = active[i];
            const b = active[j];
            if (a.startDate <= b.endDate && b.startDate <= a.endDate) {
                return {
                    error: `Seasonal periods overlap: "${a.name || 'Season'}" and "${b.name || 'Season'}".`,
                };
            }
        }
    }

    return { seasons };
}

/** Replace-all seasonal prices for a property (transaction-friendly). */
async function syncSeasonalPrices(db, propertyId, seasons) {
    await db.seasonalPrice.deleteMany({ where: { propertyId } });
    if (!seasons?.length) return [];
    await db.seasonalPrice.createMany({
        data: seasons.map((s) => ({
            propertyId,
            name: s.name,
            startDate: s.startDate,
            endDate: s.endDate,
            nightlyRate: s.nightlyRate,
            weekendRate: s.weekendRate,
            isActive: s.isActive !== false,
        })),
    });
    // Caller reloads property outside the transaction when needed.
    return [];
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
    calculateStayQuote,
    findSeasonForNight,
    parseSeasonalPricesInput,
    syncSeasonalPrices,
    validateDateRange,
    findStayConflicts,
    hasConflicts,
    conflictMessage,
    propertyIdsBlockedForRange,
};
