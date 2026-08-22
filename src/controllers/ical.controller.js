const icalService = require('../services/ical.service');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { ROLES } = require('../middleware/roles');

exports.importIcs = async (req, res) => {
    try {
        const { propertyId, source, sourceUrl } = req.body;

        if (!propertyId || !source || !sourceUrl) {
            return res.status(400).json({
                success: false,
                message: 'propertyId, source, and sourceUrl are required.'
            });
        }

        // Validate property exists
        const property = await prisma.property.findUnique({ where: { id: propertyId } });
        if (!property) {
            return res.status(404).json({ success: false, message: 'Property not found.' });
        }

        if (req.user.role !== ROLES.ADMIN && property.ownerId !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. You can only import calendars for your own properties.',
            });
        }

        const result = await icalService.importFromUrl(propertyId, source, sourceUrl);
        const imported =
            typeof result === 'number'
                ? result
                : (result?.imported || 0) + (result?.updated || 0);

        return res.status(200).json({
            success: true,
            status: 'ok',
            imported,
            details: typeof result === 'object' ? result : { imported: result },
            message: `Calendar synced (${imported} events created/updated). Checkout days stay free for same-day check-in.`,
        });
    } catch (error) {
        console.error('Error in importIcs controller:', error);
        return res.status(500).json({
            success: false,
            message: 'An error occurred during ICS import.',
            error: error.message
        });
    }
};

exports.exportIcs = async (req, res) => {
    try {
        const { propertyId } = req.params;

        // Remove .ics extension if it was included in the route param
        const cleanedPropertyId = propertyId.replace('.ics', '');

        const icsString = await icalService.exportForProperty(cleanedPropertyId);

        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="property-${cleanedPropertyId}.ics"`);

        return res.send(icsString);
    } catch (error) {
        console.error('Error in exportIcs controller:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to export ICS.'
        });
    }
};

exports.getBookedDates = async (req, res) => {
    try {
        const { propertyId } = req.params;
        const bookedDates = await icalService.getBookedDatesForProperty(propertyId);

        return res.status(200).json({
            success: true,
            data: bookedDates
        });
    } catch (error) {
        console.error('Error in getBookedDates controller:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch booked dates.'
        });
    }
};
