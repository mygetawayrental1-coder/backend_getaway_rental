const prisma = require('../config/database');
const {
    stringifyJsonField,
    formatPropertyResponse,
    formatPropertiesResponse,
    getPagination,
    formatPaginatedResponse,
} = require('../utils/helpers');

// Create property
const createProperty = async (req, res) => {
    try {
        const {
            propertyName,
            location,
            state,
            country,
            latitude,
            longitude,
            guests,
            bedrooms,
            bathrooms,
            kitchens,
            ratePeriodStart,
            ratePeriodEnd,
            minRate,
            nightlyRate,
            weekendRate,
            weeklyRate,
            monthlyRate,
            additionalCharges,
            amenities,
            about,
            policyAndHouseRules,
            icalUrls,
            emailId,
        } = req.body;

        // Extract image URLs from req.files (added by uploadMultiple middleware)
        let images = [];
        if (req.files && req.files.length > 0) {
            images = req.files.map(file => `/uploads/${file.filename}`);
        } else if (req.body.images) {
            // Fallback if images were sent as a raw string or array (e.g. from postman)
            images = Array.isArray(req.body.images) ? req.body.images : [req.body.images];
        }

        // Get owner ID from authenticated user or email
        let ownerId = req.user.id;

        if (emailId && req.user.role === 'ADMIN') {
            const owner = await prisma.user.findUnique({ where: { email: emailId } });
            if (owner) ownerId = owner.id;
        }

        const property = await prisma.property.create({
            data: {
                propertyName,
                location,
                state,
                country,
                latitude,
                longitude,
                guests: parseInt(guests) || 0,
                bedrooms: parseInt(bedrooms) || 0,
                bathrooms: parseInt(bathrooms) || 0,
                kitchens: parseInt(kitchens) || 0,
                ratePeriodStart: ratePeriodStart ? new Date(ratePeriodStart) : null,
                ratePeriodEnd: ratePeriodEnd ? new Date(ratePeriodEnd) : null,
                minRate: parseInt(minRate) || 0,
                nightlyRate: parseInt(nightlyRate) || 0,
                weekendRate: parseInt(weekendRate) || 0,
                weeklyRate: parseInt(weeklyRate) || 0,
                monthlyRate: parseInt(monthlyRate) || 0,
                additionalCharges: stringifyJsonField(additionalCharges),
                amenities: stringifyJsonField(amenities),
                about,
                policyAndHouseRules,
                images: stringifyJsonField(images),
                icalUrls: stringifyJsonField(icalUrls),
                ownerId,
            },
            include: {
                owner: {
                    select: { id: true, email: true, firstName: true, lastName: true },
                },
            },
        });

        res.status(201).json({
            success: true,
            message: 'Property created successfully.',
            data: formatPropertyResponse(property),
        });
    } catch (error) {
        console.error('Create property error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create property.',
            error: error.message,
        });
    }
};

// Get all properties
const getAllProperties = async (req, res) => {
    try {
        const { page, limit, status, search, location } = req.query;
        const pagination = getPagination(page, limit);

        const where = {};
        if (status) where.status = status;
        if (location) where.location = { contains: location };
        if (search) {
            where.OR = [
                { propertyName: { contains: search } },
                { location: { contains: search } },
                { about: { contains: search } },
            ];
        }

        // Filter by owner if the authenticated user is an OWNER
        if (req.user && req.user.role === 'OWNER') {
            where.ownerId = req.user.id;
        }

        const [properties, total] = await Promise.all([
            prisma.property.findMany({
                where,
                skip: pagination.skip,
                take: pagination.take,
                orderBy: { createdAt: 'desc' },
                include: {
                    owner: {
                        select: { id: true, email: true, firstName: true, lastName: true },
                    },
                },
            }),
            prisma.property.count({ where }),
        ]);

        res.json({
            success: true,
            ...formatPaginatedResponse(
                formatPropertiesResponse(properties),
                total,
                pagination.page,
                pagination.limit
            ),
        });
    } catch (error) {
        console.error('Get all properties error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch properties.',
        });
    }
};

// Get property by ID
const getPropertyById = async (req, res) => {
    try {
        const { id } = req.params;

        const property = await prisma.property.findFirst({
            where: {
                OR: [{ id }, { propertyId: id }],
            },
            include: {
                owner: {
                    select: { id: true, email: true, firstName: true, lastName: true, phoneNumber: true },
                },
            },
        });

        if (!property) {
            return res.status(404).json({
                success: false,
                message: 'Property not found.',
            });
        }

        // Get booked dates for availability calendar
        const bookedDates = await prisma.booking.findMany({
            where: {
                propertyId: property.id,
                status: 'CONFIRMED',
                checkout: { gte: new Date() }, // Only future/current bookings
            },
            select: {
                checkin: true,
                checkout: true,
                bookingId: true,
            },
            orderBy: {
                checkin: 'asc',
            },
        });

        const propertyData = formatPropertyResponse(property);

        res.json({
            success: true,
            data: {
                ...propertyData,
                bookedDates: bookedDates.map(b => ({
                    checkin: b.checkin,
                    checkout: b.checkout,
                    bookingId: b.bookingId,
                })),
            },
        });
    } catch (error) {
        console.error('Get property by ID error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch property.',
        });
    }
};

// Get properties by owner email
const getPropertiesByEmail = async (req, res) => {
    try {
        const { email } = req.body;
        const paramEmail = req.params.email;
        const ownerEmail = paramEmail || email || req.user.email;

        const owner = await prisma.user.findUnique({
            where: { email: ownerEmail },
        });

        if (!owner) {
            return res.status(404).json({
                success: false,
                message: 'Owner not found.',
            });
        }

        // Check authorization
        if (req.user.role !== 'ADMIN' && req.user.email !== ownerEmail) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.',
            });
        }

        const properties = await prisma.property.findMany({
            where: { ownerId: owner.id },
            orderBy: { createdAt: 'desc' },
        });

        res.json({
            success: true,
            data: formatPropertiesResponse(properties),
        });
    } catch (error) {
        console.error('Get properties by email error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch properties.',
        });
    }
};

// Update property
const updateProperty = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const property = await prisma.property.findFirst({
            where: { OR: [{ id }, { propertyId: id }] },
        });

        if (!property) {
            return res.status(404).json({
                success: false,
                message: 'Property not found.',
            });
        }

        // Check ownership
        if (req.user.role !== 'ADMIN' && property.ownerId !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.',
            });
        }

        const data = {};
        const fields = [
            'propertyName', 'location', 'state', 'country', 'latitude', 'longitude',
            'about', 'policyAndHouseRules', 'status'
        ];
        const intFields = ['guests', 'bedrooms', 'bathrooms', 'kitchens', 'minRate', 'nightlyRate', 'weekendRate', 'weeklyRate', 'monthlyRate'];
        const jsonFields = ['additionalCharges', 'amenities', 'icalUrls'];
        const dateFields = ['ratePeriodStart', 'ratePeriodEnd'];

        fields.forEach(field => {
            if (updateData[field] !== undefined) data[field] = updateData[field];
        });
        intFields.forEach(field => {
            if (updateData[field] !== undefined) data[field] = parseInt(updateData[field]) || 0;
        });
        jsonFields.forEach(field => {
            if (updateData[field] !== undefined) data[field] = stringifyJsonField(updateData[field]);
        });
        dateFields.forEach(field => {
            if (updateData[field] !== undefined) data[field] = updateData[field] ? new Date(updateData[field]) : null;
        });

        // Handle image updates
        let existingImages = [];
        if (updateData.images) {
            // If the client sends back existing image URLs to keep
            existingImages = Array.isArray(updateData.images) ? updateData.images : [updateData.images];
        } else if (property.images) {
            try {
                // If nothing was passed, preserve existing ones (or client can pass empty array to clear)
                existingImages = JSON.parse(property.images);
            } catch (e) { }
        }

        let newImages = [];
        if (req.files && req.files.length > 0) {
            newImages = req.files.map(file => `/uploads/${file.filename}`);
        }

        // Combine them if any exist, otherwise omit the field
        if (existingImages.length > 0 || newImages.length > 0) {
            data.images = stringifyJsonField([...existingImages, ...newImages]);
        }

        const updated = await prisma.property.update({
            where: { id: property.id },
            data,
            include: {
                owner: {
                    select: { id: true, email: true, firstName: true, lastName: true },
                },
            },
        });

        res.json({
            success: true,
            message: 'Property updated successfully.',
            data: formatPropertyResponse(updated),
        });
    } catch (error) {
        console.error('Update property error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update property.',
        });
    }
};

// Delete property
const deleteProperty = async (req, res) => {
    try {
        const { id } = req.params;

        const property = await prisma.property.findFirst({
            where: { OR: [{ id }, { propertyId: id }] },
        });

        if (!property) {
            return res.status(404).json({
                success: false,
                message: 'Property not found.',
            });
        }

        // Check ownership
        if (req.user.role !== 'ADMIN' && property.ownerId !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.',
            });
        }

        await prisma.property.delete({ where: { id: property.id } });

        res.json({
            success: true,
            message: 'Property deleted successfully.',
        });
    } catch (error) {
        console.error('Delete property error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete property.',
        });
    }
};

// Get properties by location, dates, and guests (Mobile Search)
const getPropertiesByLocation = async (req, res) => {
    try {
        const { name, checkin, checkout, guests } = req.method === 'GET' ? req.query : req.body;

        const where = { status: 'Active' };
        if (name) {
            where.OR = [
                { location: { contains: name } },
                { propertyName: { contains: name } },
                { state: { contains: name } },
            ];
        }
        if (guests) {
            where.guests = { gte: parseInt(guests) || 1 };
        }

        const properties = await prisma.property.findMany({
            where,
            include: {
                owner: { select: { id: true, firstName: true, email: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(formatPropertiesResponse(properties));
    } catch (error) {
        console.error('Get properties by location error:', error);
        res.status(500).json({ success: false, message: 'Failed to search properties.' });
    }
};

// Get location suggestions for search autocomplete
const getLocationSuggestions = async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json([]);

        const locations = await prisma.property.findMany({
            where: {
                status: 'Active',
                OR: [
                    { location: { contains: q } },
                    { state: { contains: q } },
                    { country: { contains: q } },
                ]
            },
            select: {
                location: true,
                state: true,
                country: true,
            },
            distinct: ['location'],
            take: 10
        });

        const suggestions = locations.map(l => ({
            location: l.location,
            state: l.state,
            country: l.country
        }));

        res.json(suggestions);
    } catch (error) {
        console.error('Location suggestions error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch suggestions.' });
    }
};

module.exports = {
    createProperty,
    getAllProperties,
    getPropertyById,
    getPropertiesByEmail,
    updateProperty,
    deleteProperty,
    getPropertiesByLocation,
    getLocationSuggestions,
};
