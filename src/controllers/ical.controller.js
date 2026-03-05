const icalService = require('../services/ical.service');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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

        const importedCount = await icalService.importFromUrl(propertyId, source, sourceUrl);

        return res.status(200).json({
            success: true,
            status: 'ok',
            imported: importedCount,
            message: `Successfully imported ${importedCount} events.`
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
