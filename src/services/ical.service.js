const ical = require('node-ical');
const icalGenerator = require('ical-generator').default;
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');
const { utcStartOfDay } = require('../utils/stayAvailability');

/**
 * Map an iCal start/end to overnight stay boundaries (UTC midnight dates).
 * Industry rule: occupy nights [checkIn, checkOut) — checkout day is free
 * for the next guest's check-in (same-day turnover).
 *
 * Timed ends like "Mar 5 11:00" become checkOut = Mar 5 00:00 UTC so Mar 5
 * is NOT a blocked night and does not conflict with a Mar 5 check-in.
 */
function toStayDateUTC(value) {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;

    // VALUE=DATE (all-day): node-ical often sets dateOnly / uses UTC midnight.
    if (value.dateOnly === true) {
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }

    // Timed events: use the civil calendar date from the parsed Date
    // (local components as interpreted by node-ical), stored as UTC midnight.
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function normalizeStayBounds(rawStart, rawEnd) {
    let checkIn = toStayDateUTC(rawStart);
    if (!checkIn) return null;

    let checkOut = toStayDateUTC(rawEnd);
    if (!checkOut) {
        checkOut = new Date(checkIn);
        checkOut.setUTCDate(checkOut.getUTCDate() + 1);
    }

    // Guard: end must be after start (at least 1 night).
    if (checkOut <= checkIn) {
        checkOut = new Date(checkIn);
        checkOut.setUTCDate(checkOut.getUTCDate() + 1);
    }

    return { checkIn, checkOut };
}

/**
 * Service to handle importing and exporting of iCal (.ics) files for properties.
 */
class IcalService {
    /**
     * Import a remote .ics URL into the database for a specific property.
     * Upserts by UID and removes events for this source that disappeared from the feed.
     * @returns {Promise<{ imported: number, updated: number, removed: number }>}
     */
    async importFromUrl(propertyId, source, url) {
        const stats = { imported: 0, updated: 0, removed: 0 };
        try {
            const { assertSafeHttpsUrl } = require('../utils/safeRemoteUrl');
        const safeUrl = await assertSafeHttpsUrl(url);
        const events = await ical.async.fromURL(safeUrl);
            const seenUids = new Set();
            const sourceKey = String(source || 'external');

            for (const key in events) {
                const event = events[key];
                if (event.type !== 'VEVENT') continue;

                const uid = String(event.uid || crypto.randomUUID());
                const bounds = normalizeStayBounds(event.start, event.end);
                if (!bounds) continue;

                seenUids.add(uid);

                const startStr = bounds.checkIn.toISOString().slice(0, 10).replace(/-/g, '');
                const endStr = bounds.checkOut.toISOString().slice(0, 10).replace(/-/g, '');
                const summary = event.summary || 'Imported Booking';
                const icsContent =
                    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\n` +
                    `UID:${uid}\r\nDTSTART;VALUE=DATE:${startStr}\r\nDTEND;VALUE=DATE:${endStr}\r\n` +
                    `SUMMARY:${summary}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

                const existing = await prisma.icalEvent.findUnique({
                    where: {
                        propertyId_uid: { propertyId, uid },
                    },
                });

                if (existing) {
                    await prisma.icalEvent.update({
                        where: { id: existing.id },
                        data: {
                            dtStart: bounds.checkIn,
                            dtEnd: bounds.checkOut,
                            icsContent,
                            source: sourceKey,
                            summary: typeof summary === 'string' ? summary.slice(0, 500) : null,
                        },
                    });
                    stats.updated += 1;
                } else {
                    await prisma.icalEvent.create({
                        data: {
                            uid,
                            propertyId,
                            dtStart: bounds.checkIn,
                            dtEnd: bounds.checkOut,
                            icsContent,
                            source: sourceKey,
                            summary: typeof summary === 'string' ? summary.slice(0, 500) : null,
                        },
                    });
                    stats.imported += 1;
                }
            }

            // Drop cancelled/removed events for this property+source (not our internal bookings).
            if (sourceKey !== 'mygatewayrental' && seenUids.size >= 0) {
                const stale = await prisma.icalEvent.findMany({
                    where: {
                        propertyId,
                        source: sourceKey,
                        ...(seenUids.size
                            ? { uid: { notIn: Array.from(seenUids) } }
                            : {}),
                    },
                    select: { id: true },
                });
                // If feed returned zero VEVENTs, don't wipe everything (transient empty parse).
                if (seenUids.size > 0 && stale.length) {
                    await prisma.icalEvent.deleteMany({
                        where: { id: { in: stale.map((r) => r.id) } },
                    });
                    stats.removed = stale.length;
                }
            }
        } catch (error) {
            console.error(`[iCal Import] Failed to import from ${url}:`, error.message);
            throw error;
        }

        return stats;
    }

    /**
     * Export all booked events for a property as an ICS string (date-only VALUE=DATE).
     */
    async exportForProperty(propertyId) {
        const events = await prisma.icalEvent.findMany({
            where: { propertyId },
        });

        const calendar = icalGenerator({
            name: process.env.SITE_NAME || 'MyGatewayRental Calendar',
        });
        calendar.prodId({
            company: 'MyGatewayRental',
            product: 'BookingCalendar',
            language: 'EN',
        });

        for (const e of events) {
            const start = utcStartOfDay(e.dtStart) || e.dtStart;
            const end = utcStartOfDay(e.dtEnd) || e.dtEnd;
            calendar.createEvent({
                id: e.uid,
                start,
                end,
                allDay: true,
                summary:
                    e.source === 'mygatewayrental'
                        ? 'Direct Booking - MyGatewayRental'
                        : 'Imported Booking',
                description: `Source: ${e.source}`,
            });
        }

        return calendar.toString();
    }

    /**
     * Booked ranges for UI — checkout is exclusive (available for next check-in).
     */
    async getBookedDatesForProperty(propertyId) {
        const events = await prisma.icalEvent.findMany({
            where: { propertyId },
            select: { dtStart: true, dtEnd: true },
        });

        return events.map((e) => {
            const checkIn = utcStartOfDay(e.dtStart) || e.dtStart;
            const checkOut = utcStartOfDay(e.dtEnd) || e.dtEnd;
            return {
                checkin: checkIn.toISOString().split('T')[0],
                checkout: checkOut.toISOString().split('T')[0],
            };
        });
    }

    /**
     * Internal: store overnight bounds as UTC midnights (same as import).
     */
    async createEventForInternalBooking(inquiry) {
        if (!inquiry.checkin || !inquiry.checkout || !inquiry.propertyId) {
            throw new Error('Booking must contain checkin, checkout, and propertyId.');
        }

        const checkIn = utcStartOfDay(inquiry.checkin);
        const checkOut = utcStartOfDay(inquiry.checkout);
        if (!checkIn || !checkOut || checkOut <= checkIn) {
            throw new Error('Invalid checkin/checkout for iCal event.');
        }

        const uid = inquiry.id + '-' + crypto.randomUUID().substring(0, 8);

        await prisma.icalEvent.create({
            data: {
                uid,
                inquiryId: inquiry.id,
                propertyId: inquiry.propertyId,
                dtStart: checkIn,
                dtEnd: checkOut,
                source: 'mygatewayrental',
                summary: 'Direct Booking - MyGatewayRental',
            },
        });
    }
}

module.exports = new IcalService();
module.exports.normalizeStayBounds = normalizeStayBounds;
module.exports.toStayDateUTC = toStayDateUTC;
