const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const icalService = require('../services/ical.service');

// Run every 5 minutes: '*/5 * * * *'
const startIcalScheduler = () => {
    cron.schedule('*/5 * * * *', async () => {
        console.log('[iCal Scheduler] Starting background sync...');
        try {
            // Fetch all properties that have configured icalUrls (not null and not empty)
            const properties = await prisma.property.findMany({
                where: {
                    icalUrls: { not: null }
                }
            });

            for (const property of properties) {
                // icalUrls is stored as a JSON string in the database
                let urlsMap = {};
                try {
                    urlsMap = JSON.parse(property.icalUrls);
                } catch (e) {
                    console.error(`[iCal Scheduler] Error parsing JSON for property ${property.id}`);
                    continue;
                }

                if (!urlsMap || typeof urlsMap !== 'object') continue;

                // Example urlsMap: { "airbnb": "https://...", "booking.com": "https://..." }
                for (const [source, url] of Object.entries(urlsMap)) {
                    if (!url) continue;

                    try {
                        const result = await icalService.importFromUrl(property.id, source, url);
                        const n =
                            typeof result === 'number'
                                ? result
                                : (result?.imported || 0) + (result?.updated || 0) + (result?.removed || 0);
                        if (n > 0) {
                            console.log(
                                `[iCal Scheduler] Synced property ${property.id} from ${source}:`,
                                result,
                            );
                        }
                    } catch (error) {
                        console.error(`[iCal Scheduler] Failed to sync property ${property.id} from ${source}:`, error.message);
                    }
                }
            }
        } catch (error) {
            console.error('[iCal Scheduler] Global error during background sync:', error);
        }
    });

    console.log('[iCal Scheduler] Cron job initialized (runs every 5 minutes).');
};

module.exports = { startIcalScheduler };
