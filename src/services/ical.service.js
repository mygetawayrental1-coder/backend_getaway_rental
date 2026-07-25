const ical = require('node-ical');
const icalGenerator = require('ical-generator').default;
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');

/**
 * Service to handle importing and exporting of iCal (.ics) files for properties.
 */
class IcalService {

    /**
     * Import a remote .ics URL into the database for a specific property.
     * @param {String} propertyId - The `id` (or `propertyId`) from the Property table.
     * @param {String} source - Source platform name (e.g., 'airbnb', 'booking.com').
     * @param {String} url - The .ics URL.
     * @returns {Promise<Number>} - The number of new events imported.
     */
    async importFromUrl(propertyId, source, url) {
        let importedCount = 0;
        try {
            // Fetch and parse the remote iCal URL
            const events = await ical.async.fromURL(url);

            for (const key in events) {
                const event = events[key];

                // We only care about VEVENT type
                if (event.type !== 'VEVENT') continue;

                const uid = event.uid || crypto.randomUUID();

                // Duplicate check — same UID may exist on another property
                const existing = await prisma.icalEvent.findUnique({
                    where: {
                        propertyId_uid: {
                            propertyId,
                            uid,
                        },
                    },
                });

                if (existing) {
                    continue; // Skip already imported for this property
                }

                // Parse dates. node-ical creates native Date objects for start/end
                const dtStart = event.start;
                let dtEnd = event.end;

                if (!dtStart) {
                    continue; // Skip invalid events without start dates
                }

                // If it's an all day event and has no explicit end, assume 1 day
                if (!dtEnd) {
                    dtEnd = new Date(dtStart.getTime());
                    dtEnd.setDate(dtEnd.getDate() + 1);
                }

                // Re-build a simple raw ICS string for the event (optional, matching Java backend pattern)
                const startStr = dtStart.toISOString().replace(/[-:]/g, '').substring(0, 15) + 'Z';
                const endStr = dtEnd.toISOString().replace(/[-:]/g, '').substring(0, 15) + 'Z';
                const icsContent = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:${startStr}\r\nDTEND:${endStr}\r\nSUMMARY:${event.summary || 'Imported Booking'}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

                await prisma.icalEvent.create({
                    data: {
                        uid: uid,
                        propertyId: propertyId, // Note: Make sure this maps to the correct internal PK or unique ID
                        dtStart: dtStart,
                        dtEnd: dtEnd,
                        icsContent: icsContent,
                        source: source
                    }
                });

                importedCount++;
            }
        } catch (error) {
            console.error(`[iCal Import] Failed to import from ${url}:`, error.message);
            throw error;
        }

        return importedCount;
    }

    /**
     * Export all booked events for a property as an ICS string.
     * @param {String} propertyId - The ID of the property.
     * @returns {Promise<String>} - The combined VCALENDAR ICS string.
     */
    async exportForProperty(propertyId) {
        // Fetch all events for this property
        const events = await prisma.icalEvent.findMany({
            where: { propertyId: propertyId }
        });

        // Initialize ical-generator calendar
        const calendar = icalGenerator({ name: process.env.SITE_NAME || 'MyGatewayRental Calendar' });
        calendar.prodId({
            company: 'MyGatewayRental',
            product: 'BookingCalendar',
            language: 'EN'
        });

        for (const e of events) {
            // Check if we should use existing raw ICS or build new
            // For simplicity and correctness with ical-generator, we'll build new events natively
            calendar.createEvent({
                id: e.uid,
                start: e.dtStart,
                end: e.dtEnd,
                summary: e.source === 'mygatewayrental' ? 'Direct Booking - MyGatewayRental' : 'Imported Booking',
                description: `Source: ${e.source}`,
                // if it's an internal booking, we can add more details from the DB if necessary
            });
        }

        return calendar.toString();
    }

    /**
     * Get a simple array of booked date ranges for the frontend calendar picker.
     * @param {String} propertyId 
     * @returns {Promise<Array>}
     */
    async getBookedDatesForProperty(propertyId) {
        const events = await prisma.icalEvent.findMany({
            where: { propertyId: propertyId },
            select: { dtStart: true, dtEnd: true }
        });

        return events.map(e => ({
            checkin: e.dtStart.toISOString().split('T')[0],
            checkout: e.dtEnd.toISOString().split('T')[0]
        }));
    }

    /**
     * Internal bridging method: Creates an iCal event when a direct Inquiry/Booking is confirmed.
     * @param {Object} inquiry - The inquiry/booking object.
     */
    async createEventForInternalBooking(inquiry) {
        if (!inquiry.checkin || !inquiry.checkout || !inquiry.propertyId) {
            throw new Error("Booking must contain checkin, checkout, and propertyId.");
        }

        const uid = inquiry.id + '-' + crypto.randomUUID().substring(0, 8);
        const dtStart = new Date(inquiry.checkin);
        const dtEnd = new Date(inquiry.checkout);

        await prisma.icalEvent.create({
            data: {
                uid: uid,
                inquiryId: inquiry.id,
                propertyId: inquiry.propertyId,
                dtStart: dtStart,
                dtEnd: dtEnd,
                source: 'mygatewayrental'
            }
        });
    }
}

module.exports = new IcalService();
