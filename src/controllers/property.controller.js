const prisma = require('../config/database');
const { multerFileToPublicPath } = require('../config/storage');
const icalService = require('../services/ical.service');
const { verifyCaptcha } = require('./captcha.controller');
const {
    stringifyJsonField,
    formatPropertyResponse,
    formatPropertiesResponse,
    getPagination,
    formatPaginatedResponse,
    propertyWhereForCatalogLocation,
} = require('../utils/helpers');
const {
    slugify,
    sanitizePropertySeoFields,
    ensureUniquePropertySlug,
} = require('../utils/seo');

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

        const [ownerBlocks, bookingBlocks, acceptedRequests, icalBlocks] = await Promise.all([
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
            prisma.guestRequest.findMany({
                where: {
                    propertyId: property.id,
                    status: 'ACCEPTED',
                    AND: [
                        { checkin: { not: null } },
                        { checkout: { not: null } },
                        { checkin: { lte: rangeEnd } },
                        { checkout: { gt: rangeStart } },
                    ],
                },
                select: {
                    checkin: true,
                    checkout: true,
                },
            }),
            prisma.icalEvent.findMany({
                where: {
                    propertyId: property.id,
                    dtStart: { lte: rangeEnd },
                    dtEnd: { gt: rangeStart },
                },
                select: {
                    dtStart: true,
                    dtEnd: true,
                },
                orderBy: { dtStart: 'asc' },
            }),
        ]);

        const stayBlocks = [
            ...bookingBlocks.map((b) => ({
                checkin: b.checkin,
                checkout: b.checkout,
            })),
            ...acceptedRequests.map((r) => ({
                checkin: r.checkin,
                checkout: r.checkout,
            })),
        ];

        res.json({
            success: true,
            blockedByOwner: ownerBlocks.map((row) => formatDateOnly(row.date)),
            blockedByBookings: stayBlocks,
            blockedByIcal: icalBlocks.map((b) => ({
                checkin: b.dtStart,
                checkout: b.dtEnd,
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
            suitability,
            checkInTime,
            checkOutTime,
            minNights,
            maxNights,
            customFields,
            locationId,
        } = req.body;

        // Removed captcha verification as route is protected by authentication


        // Extract image URLs from req.files (added by uploadMultiple middleware)
        let images = [];
        if (req.files && req.files.length > 0) {
            images = req.files.map(multerFileToPublicPath);
        } else if (req.body.images) {
            const parsed = parseBodyJsonArray(req.body.images);
            images = parsed ?? (Array.isArray(req.body.images) ? req.body.images : [req.body.images]);
        }

        if (images.length < 5) {
            return res.status(400).json({
                success: false,
                message: 'Upload at least 5 photos.',
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

        // Resolve catalog CITY — sync country / state / city display fields
        let resolvedLocationId = null;
        let locationText = location;
        let stateText = state;
        let countryText = country;
        let latText = latitude;
        let lngText = longitude;
        if (locationId != null && String(locationId).trim() !== '') {
            const id = parseInt(String(locationId), 10);
            if (!Number.isNaN(id)) {
                const catalog = await prisma.location.findUnique({ where: { id } });
                if (!catalog) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid location. Pick a destination from the list.',
                    });
                }
                if (catalog.type !== 'CITY') {
                    return res.status(400).json({
                        success: false,
                        message: 'Select a City (not a country or state).',
                    });
                }
                const { syncPropertyFieldsFromCity } = require('../utils/locationHierarchy');
                try {
                    const synced = await syncPropertyFieldsFromCity(catalog);
                    resolvedLocationId = synced.locationId;
                    locationText = synced.location;
                    stateText = synced.state;
                    countryText = synced.country;
                    // Prefer exact map pin from client; fall back to city center
                    const hasClientPin =
                        latitude != null &&
                        String(latitude).trim() !== '' &&
                        longitude != null &&
                        String(longitude).trim() !== '';
                    if (!hasClientPin) {
                        if (synced.latitude) latText = synced.latitude;
                        if (synced.longitude) lngText = synced.longitude;
                    }
                } catch (e) {
                    return res.status(400).json({
                        success: false,
                        message: e.message || 'Select a City from the list.',
                    });
                }
            }
        }

        if (!resolvedLocationId) {
            return res.status(400).json({
                success: false,
                message: 'Location is required. Select Country → State → City.',
            });
        }

        if (!locationText || !String(locationText).trim()) {
            return res.status(400).json({
                success: false,
                message: 'Location is required. Select a destination from the list.',
            });
        }

        const baseSlug = slugify(propertyName || 'rental') || 'stay';
        const requestedSlug = slugBody && String(slugBody).trim()
            ? slugify(slugBody)
            : `${baseSlug}-${Date.now().toString(36)}`;
        if (!requestedSlug) {
            return res.status(400).json({
                success: false,
                message: 'URL slug must contain letters or numbers.',
            });
        }
        const slug = await ensureUniquePropertySlug(prisma, requestedSlug);

        const property = await prisma.property.create({
            data: {
                propertyName,
                location: String(locationText).trim(),
                state: stateText || null,
                country: countryText || null,
                latitude: latText || null,
                longitude: lngText || null,
                locationId: resolvedLocationId,
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
                suitability: suitability ? (typeof suitability === 'string' ? suitability : JSON.stringify(suitability)) : null,
                checkInTime: checkInTime || null,
                checkOutTime: checkOutTime || null,
                minNights: minNights != null ? parseInt(minNights, 10) || 1 : 1,
                maxNights: maxNights != null ? parseInt(maxNights, 10) || null : null,
                customFields: stringifyJsonField(customFields),
            },
            include: {
                owner: {
                    select: { id: true, email: true, firstName: true, lastName: true },
                },
                catalogLocation: true,
            },
        });

        // Sync iCal URLs if any
        if (property.icalUrls) {
            try {
                const parsedUrls = JSON.parse(property.icalUrls);
                for (const [source, url] of Object.entries(parsedUrls)) {
                    if (url) {
                        icalService.importFromUrl(property.id, source, String(url)).catch(err => {
                            console.error(`Failed to background sync iCal for ${source}:`, err);
                        });
                    }
                }
            } catch (err) {
                console.error('Failed to parse icalUrls for sync:', err);
            }
        }

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
        const isAdmin = req.user?.role === 'ADMIN';
        const pagination = getPagination(page, limit, { maxLimit: isAdmin ? 2000 : 100 });

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

        // Owners see their own listings; admins see all; guests/USER see public Active catalog.
        if (req.user?.role === 'OWNER') {
            where.ownerId = req.user.id;
        } else if (req.user?.role === 'ADMIN') {
            // no owner filter
        } else {
            if (!status) where.status = 'Active';
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
                catalogLocation: true,
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
        const { captchaId, captchaCode, ...updateData } = req.body;

        // Removed captcha verification as route is protected by authentication

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
            'about', 'policyAndHouseRules', 'status', 'rentalType', 'videoUrl', 'policyDetails',
            'checkInTime', 'checkOutTime',
        ];
        const intFields = ['guests', 'bedrooms', 'bathrooms', 'kitchens', 'minRate', 'nightlyRate', 'weekendRate', 'weeklyRate', 'monthlyRate', 'areaM2', 'discountPercent', 'minNights', 'maxNights'];
        const boolFields = ['isFeatured', 'isNew'];
        const jsonFields = ['additionalCharges', 'amenities', 'icalUrls', 'suitability', 'customFields'];
        const dateFields = ['ratePeriodStart', 'ratePeriodEnd'];

        fields.forEach(field => {
            if (updateData[field] !== undefined) data[field] = updateData[field];
        });

        // Slug + SEO: sanitize, validate lengths, keep unique clean URLs
        const seoPatch = sanitizePropertySeoFields(updateData);
        if (seoPatch.error) {
            return res.status(400).json({ success: false, message: seoPatch.error });
        }
        Object.assign(data, seoPatch.data);
        if (data.slug && data.slug !== property.slug) {
            data.slug = await ensureUniquePropertySlug(prisma, data.slug, property.id);
        }
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

        // Bind to Admin Location catalog when locationId is sent (CITY only)
        if (updateData.locationId !== undefined) {
            const raw = updateData.locationId;
            if (raw === null || raw === '' || raw === 'null') {
                data.locationId = null;
            } else {
                const locId = parseInt(String(raw), 10);
                if (Number.isNaN(locId)) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid locationId.',
                    });
                }
                const catalog = await prisma.location.findUnique({ where: { id: locId } });
                if (!catalog) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid location. Pick a destination from the list.',
                    });
                }
                if (catalog.type !== 'CITY') {
                    return res.status(400).json({
                        success: false,
                        message: 'Select a City (not a country or state).',
                    });
                }
                const { syncPropertyFieldsFromCity } = require('../utils/locationHierarchy');
                try {
                    const synced = await syncPropertyFieldsFromCity(catalog);
                    data.locationId = synced.locationId;
                    data.location = synced.location;
                    data.state = synced.state;
                    data.country = synced.country;
                    // Keep owner's exact map pin when they sent lat/lng on this save
                    const hasClientPin =
                        updateData.latitude != null &&
                        String(updateData.latitude).trim() !== '' &&
                        updateData.longitude != null &&
                        String(updateData.longitude).trim() !== '';
                    if (!hasClientPin) {
                        if (synced.latitude) data.latitude = synced.latitude;
                        if (synced.longitude) data.longitude = synced.longitude;
                    }
                } catch (e) {
                    return res.status(400).json({
                        success: false,
                        message: e.message || 'Select a City from the list.',
                    });
                }
            }
        }

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
            newImages = req.files.map(multerFileToPublicPath);
        }

        // Combine them if any exist, otherwise omit the field
        if (existingImages.length > 0 || newImages.length > 0) {
            const combined = [...existingImages, ...newImages];
            if (combined.length < 5) {
                return res.status(400).json({
                    success: false,
                    message: 'Keep at least 5 photos.',
                });
            }
            data.images = stringifyJsonField(combined);
        }

        const updated = await prisma.property.update({
            where: { id: property.id },
            data,
            include: {
                owner: {
                    select: { id: true, email: true, firstName: true, lastName: true },
                },
                catalogLocation: true,
            },
        });

        // Sync iCal URLs if any
        if (updated.icalUrls) {
            try {
                const parsedUrls = JSON.parse(updated.icalUrls);
                for (const [source, url] of Object.entries(parsedUrls)) {
                    if (url) {
                        icalService.importFromUrl(updated.id, source, String(url)).catch(err => {
                            console.error(`Failed to background sync iCal for ${source}:`, err);
                        });
                    }
                }
            } catch (err) {
                console.error('Failed to parse icalUrls for sync:', err);
            }
        }

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
            const catalog = await prisma.location.findFirst({
                where: {
                    isActive: true,
                    name: { equals: String(name).trim(), mode: 'insensitive' },
                },
            });
            if (catalog) {
                const { collectCityIdsForLocation } = require('../utils/locationHierarchy');
                const cityIds = await collectCityIdsForLocation(catalog);
                const locFilter = propertyWhereForCatalogLocation(catalog, {
                    activeOnly: false,
                    cityIds,
                });
                if (locFilter?.OR) where.OR = locFilter.OR;
            } else {
                where.OR = [
                    { location: { contains: name } },
                    { propertyName: { contains: name } },
                    { state: { contains: name } },
                ];
            }
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
