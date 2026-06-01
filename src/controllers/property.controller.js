const prisma = require('../config/database');
const { verifyCaptcha } = require('./captcha.controller');
const {
    stringifyJsonField,
    formatPropertyResponse,
    formatPropertiesResponse,
    getPagination,
    formatPaginatedResponse,
} = require('../utils/helpers');

const BLOCKING_BOOKING_STATUSES = ['CONFIRMED', 'ONGOING'];

/** Parse JSON array fields sent as strings via multipart FormData. */
function parseBodyJsonArray(value) {
    if (value == null || value === '') return null;
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) return parsed;
        } catch {
            return null;
        }
    }
    return null;
}

function startOfDay(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    // Normalize to UTC midnight. The `date` column is `@db.Date`, which stores
    // only the calendar date in UTC, so we must build the day from UTC parts to
    // avoid an off-by-one shift in timezones ahead of UTC (e.g. IST).
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function formatDateOnly(value) {
    const d = startOfDay(value);
    if (!d) return null;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

async function resolvePropertyByParam(id) {
    return prisma.property.findFirst({
        where: { OR: [{ id }, { propertyId: id }] },
    });
}

async function assertPropertyOwner(req, res, property) {
    if (!property) {
        res.status(404).json({ success: false, message: 'Property not found.' });
        return false;
    }
    if (req.user.role !== 'ADMIN' && property.ownerId !== req.user.id) {
        res.status(403).json({ success: false, message: 'Access denied.' });
        return false;
    }
    return true;
}

/**
 * GET /properties/:id/availability
 */
const getAvailability = async (req, res) => {
    try {
        const { id } = req.params;
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: 'startDate and endDate query parameters are required.',
            });
        }

        const rangeStart = startOfDay(startDate);
        const rangeEnd = startOfDay(endDate);
        if (!rangeStart || !rangeEnd) {
            return res.status(400).json({
                success: false,
                message: 'Invalid startDate or endDate.',
            });
        }
        if (rangeStart > rangeEnd) {
            return res.status(400).json({
                success: false,
                message: 'endDate must be on or after startDate.',
            });
        }

        const property = await resolvePropertyByParam(id);
        if (!property) {
            return res.status(404).json({ success: false, message: 'Property not found.' });
        }

        const [ownerBlocks, bookingBlocks] = await Promise.all([
            prisma.propertyAvailability.findMany({
                where: {
                    propertyId: property.id,
                    isAvailable: false,
                    date: { gte: rangeStart, lte: rangeEnd },
                },
                orderBy: { date: 'asc' },
            }),
            prisma.booking.findMany({
                where: {
                    propertyId: property.id,
                    status: { in: BLOCKING_BOOKING_STATUSES },
                    checkin: { lte: rangeEnd },
                    checkout: { gt: rangeStart },
                },
                select: {
                    checkin: true,
                    checkout: true,
                },
                orderBy: { checkin: 'asc' },
            }),
        ]);

        res.json({
            success: true,
            blockedByOwner: ownerBlocks.map((row) => formatDateOnly(row.date)),
            blockedByBookings: bookingBlocks.map((b) => ({
                checkin: b.checkin,
                checkout: b.checkout,
            })),
        });
    } catch (error) {
        console.error('Get availability error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch availability.' });
    }
};

/**
 * POST /properties/:id/availability
 */
const setAvailability = async (req, res) => {
    try {
        const { id } = req.params;
        const { dates, isAvailable, note } = req.body;

        if (!Array.isArray(dates) || dates.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'dates must be a non-empty array of ISO date strings.',
            });
        }
        if (typeof isAvailable !== 'boolean') {
            return res.status(400).json({
                success: false,
                message: 'isAvailable must be a boolean.',
            });
        }

        const property = await resolvePropertyByParam(id);
        if (!(await assertPropertyOwner(req, res, property))) return;

        const parsedDates = dates.map(startOfDay);
        if (parsedDates.some((d) => !d)) {
            return res.status(400).json({
                success: false,
                message: 'One or more dates are invalid.',
            });
        }

        const uniqueDates = [...new Map(parsedDates.map((d) => [d.getTime(), d])).values()];

        await prisma.$transaction(
            uniqueDates.map((date) =>
                prisma.propertyAvailability.upsert({
                    where: {
                        propertyId_date: {
                            propertyId: property.id,
                            date,
                        },
                    },
                    create: {
                        propertyId: property.id,
                        date,
                        isAvailable,
                        note: note || null,
                    },
                    update: {
                        isAvailable,
                        ...(note !== undefined ? { note: note || null } : {}),
                    },
                }),
            ),
        );

        res.json({ success: true, updated: uniqueDates.length });
    } catch (error) {
        console.error('Set availability error:', error);
        res.status(500).json({ success: false, message: 'Failed to update availability.' });
    }
};

/**
 * DELETE /properties/:id/availability
 */
const clearAvailability = async (req, res) => {
    try {
        const { id } = req.params;
        const { dates } = req.body;

        if (!Array.isArray(dates) || dates.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'dates must be a non-empty array of ISO date strings.',
            });
        }

        const property = await resolvePropertyByParam(id);
        if (!(await assertPropertyOwner(req, res, property))) return;

        const parsedDates = dates.map(startOfDay).filter(Boolean);
        if (parsedDates.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'One or more dates are invalid.',
            });
        }

        const result = await prisma.propertyAvailability.deleteMany({
            where: {
                propertyId: property.id,
                date: { in: parsedDates },
            },
        });

        res.json({ success: true, deleted: result.count });
    } catch (error) {
        console.error('Clear availability error:', error);
        res.status(500).json({ success: false, message: 'Failed to clear availability.' });
    }
};

const { assertCanCreateListing } = require('../services/subscriptionAccess.service');

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
            captchaId,
            captchaCode,
            rentalType,
            slug: slugBody,
            areaM2,
            discountPercent,
            videoUrl,
        } = req.body;

        // Verify Captcha before proceeding
        if (!captchaId || !captchaCode) {
            return res.status(400).json({
                success: false,
                message: 'Captcha is required.',
            });
        }
        const isCaptchaValid = verifyCaptcha(captchaId, captchaCode);
        if (!isCaptchaValid) {
            return res.status(400).json({
                success: false,
                message: 'Invalid captcha.',
            });
        }

        // Extract image URLs from req.files (added by uploadMultiple middleware)
        let images = [];
        if (req.files && req.files.length > 0) {
            images = req.files.map(file => `/uploads/${file.filename}`);
        } else if (req.body.images) {
            const parsed = parseBodyJsonArray(req.body.images);
            images = parsed ?? (Array.isArray(req.body.images) ? req.body.images : [req.body.images]);
        }

        if (images.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Upload at least one photo.',
            });
        }

        const amenitiesList = parseBodyJsonArray(amenities) ?? amenities;

        const listingAccess = await assertCanCreateListing(req.user.id);
        if (!listingAccess.allowed && req.user.role !== 'ADMIN') {
            return res.status(listingAccess.status).json({
                success: false,
                message: listingAccess.message,
            });
        }

        // Get owner ID from authenticated user or email
        let ownerId = req.user.id;

        if (emailId && req.user.role === 'ADMIN') {
            const owner = await prisma.user.findUnique({ where: { email: emailId } });
            if (owner) ownerId = owner.id;
        }

        const baseSlug = String(propertyName || 'rental')
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .slice(0, 50);
        const slug =
            slugBody && String(slugBody).trim()
                ? String(slugBody).trim()
                : `${baseSlug || 'stay'}-${Date.now().toString(36)}`;

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
                amenities: stringifyJsonField(amenitiesList),
                about,
                policyAndHouseRules,
                images: stringifyJsonField(images),
                icalUrls: stringifyJsonField(icalUrls),
                ownerId,
                slug,
                rentalType: rentalType || null,
                areaM2: areaM2 != null ? parseInt(areaM2, 10) || null : null,
                discountPercent: discountPercent != null ? parseInt(discountPercent, 10) || null : null,
                videoUrl: videoUrl || null,
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

        // Owners only see their own listings; admins see all (admin portal / moderation).
        if (req.user && req.user.role !== 'ADMIN') {
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

/** Owner dashboard — only the signed-in user's properties. */
const getMyProperties = async (req, res) => {
    try {
        const { page, limit, status, search } = req.query;
        const pagination = getPagination(page, limit);

        const where = { ownerId: req.user.id };
        if (status) where.status = status;
        if (search) {
            where.OR = [
                { propertyName: { contains: search } },
                { location: { contains: search } },
                { about: { contains: search } },
            ];
        }

        const [properties, total] = await Promise.all([
            prisma.property.findMany({
                where,
                skip: pagination.skip,
                take: pagination.take,
                orderBy: { createdAt: 'desc' },
            }),
            prisma.property.count({ where }),
        ]);

        res.json({
            success: true,
            ...formatPaginatedResponse(
                formatPropertiesResponse(properties),
                total,
                pagination.page,
                pagination.limit,
            ),
        });
    } catch (error) {
        console.error('Get my properties error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch your properties.',
        });
    }
};

// Get properties by owner email
const getPropertiesByEmail = async (req, res) => {
    try {
        const { email } = req.body || {};
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
            'about', 'policyAndHouseRules', 'status', 'slug', 'rentalType', 'videoUrl', 'policyDetails',
        ];
        const intFields = ['guests', 'bedrooms', 'bathrooms', 'kitchens', 'minRate', 'nightlyRate', 'weekendRate', 'weeklyRate', 'monthlyRate', 'areaM2', 'discountPercent'];
        const boolFields = ['isFeatured', 'isNew'];
        const jsonFields = ['additionalCharges', 'amenities', 'icalUrls'];
        const dateFields = ['ratePeriodStart', 'ratePeriodEnd'];

        fields.forEach(field => {
            if (updateData[field] !== undefined) data[field] = updateData[field];
        });
        intFields.forEach(field => {
            if (updateData[field] !== undefined) data[field] = parseInt(updateData[field]) || 0;
        });
        boolFields.forEach((field) => {
            if (updateData[field] !== undefined) data[field] = Boolean(updateData[field]);
        });
        jsonFields.forEach(field => {
            if (updateData[field] !== undefined) {
                const parsed = parseBodyJsonArray(updateData[field]);
                data[field] = stringifyJsonField(parsed ?? updateData[field]);
            }
        });
        dateFields.forEach(field => {
            if (updateData[field] !== undefined) data[field] = updateData[field] ? new Date(updateData[field]) : null;
        });

        // Handle image updates
        let existingImages = [];
        if (updateData.images !== undefined) {
            const parsed = parseBodyJsonArray(updateData.images);
            existingImages = parsed ?? (Array.isArray(updateData.images) ? updateData.images : [updateData.images]);
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
    getMyProperties,
    getPropertyById,
    getPropertiesByEmail,
    updateProperty,
    deleteProperty,
    getPropertiesByLocation,
    getLocationSuggestions,
    getAvailability,
    setAvailability,
    clearAvailability,
};
