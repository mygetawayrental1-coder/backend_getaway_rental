const prisma = require('../../config/database');
const {
    formatPropertiesResponse,
    getPagination,
    propertyWhereForCatalogLocation,
} = require('../../utils/helpers');

function buildOrder(sort) {
    switch (sort) {
        case 'price_asc':
            return { nightlyRate: 'asc' };
        case 'price_desc':
            return { nightlyRate: 'desc' };
        case 'name_asc':
            return { propertyName: 'asc' };
        case 'name_desc':
            return { propertyName: 'desc' };
        case 'newest':
        default:
            return { createdAt: 'desc' };
    }
}

/** Count / list where: FK first, string fallback so old listings still count. */
function propertyLocationWhere(loc) {
    return propertyWhereForCatalogLocation(loc, { activeOnly: true });
}

exports.listLocations = async (req, res) => {
    try {
        const locations = await prisma.location.findMany({
            where: { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        });

        const withCounts = await Promise.all(
            locations.map(async (loc) => {
                const rentalCount = await prisma.property.count({
                    where: propertyLocationWhere(loc),
                });
                return { ...loc, rentalCount };
            }),
        );

        res.json({ success: true, locations: withCounts });
    } catch (error) {
        console.error('[web/locations] list', error);
        res.status(500).json({ success: false, message: 'Failed to fetch locations.' });
    }
};

exports.getBySlug = async (req, res) => {
    try {
        const { slug } = req.params;

        const location = await prisma.location.findUnique({
            where: { slug },
        });

        if (!location || !location.isActive) {
            return res.status(404).json({ success: false, message: 'Location not found.' });
        }

        const rentalCount = await prisma.property.count({
            where: propertyLocationWhere(location),
        });

        res.json({ success: true, location: { ...location, rentalCount } });
    } catch (error) {
        console.error('[web/locations] slug', error);
        res.status(500).json({ success: false, message: 'Failed to fetch location.' });
    }
};

/** GET /api/web/locations/:slug/properties */
exports.getLocationProperties = async (req, res) => {
    try {
        const { slug } = req.params;
        const { sort, page, limit } = req.query;

        const location = await prisma.location.findUnique({
            where: { slug },
        });

        if (!location || !location.isActive) {
            return res.status(404).json({ success: false, message: 'Location not found.' });
        }

        const pagination = getPagination(page, limit);
        const where = propertyLocationWhere(location);
        const orderBy = buildOrder(sort);

        const [rows, total] = await Promise.all([
            prisma.property.findMany({
                where,
                skip: pagination.skip,
                take: pagination.take,
                orderBy,
                include: {
                    owner: {
                        select: {
                            id: true,
                            email: true,
                            firstName: true,
                            lastName: true,
                            profilePic: true,
                            phoneNumber: true,
                            about: true,
                            createdAt: true,
                        },
                    },
                    catalogLocation: true,
                },
            }),
            prisma.property.count({ where }),
        ]);

        const properties = formatPropertiesResponse(rows);
        const totalPages = Math.ceil(total / pagination.limit) || 1;

        res.json({
            success: true,
            location: {
                slug: location.slug,
                name: location.name,
            },
            properties,
            total,
            page: pagination.page,
            totalPages,
        });
    } catch (error) {
        console.error('[web/locations] properties', error);
        res.status(500).json({ success: false, message: 'Failed to fetch location properties.' });
    }
};

exports.listAllAdmin = async (req, res) => {
    try {
        const locations = await prisma.location.findMany({
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        });

        const withCounts = await Promise.all(
            locations.map(async (loc) => {
                const rentalCount = await prisma.property.count({
                    where: propertyLocationWhere(loc),
                });
                return { ...loc, rentalCount };
            }),
        );

        res.json({ success: true, locations: withCounts });
    } catch (error) {
        console.error('[web/locations] admin list', error);
        res.status(500).json({ success: false, message: 'Failed to fetch locations.' });
    }
};

exports.createLocation = async (req, res) => {
    try {
        const { name, slug, parentSlug, image, description, lat, lng, sortOrder, isActive } = req.body;

        if (!name || !slug || !image) {
            return res.status(400).json({
                success: false,
                message: 'name, slug, and image are required.',
            });
        }

        const location = await prisma.location.create({
            data: {
                name: String(name).trim(),
                slug: String(slug).trim().toLowerCase(),
                parentSlug: parentSlug ? String(parentSlug).trim() : null,
                image: String(image).trim(),
                description: description ? String(description).trim() : null,
                lat: lat != null ? parseFloat(lat) : null,
                lng: lng != null ? parseFloat(lng) : null,
                sortOrder: sortOrder != null ? parseInt(sortOrder, 10) : 0,
                isActive: isActive !== undefined ? Boolean(isActive) : true,
            },
        });

        res.status(201).json({ success: true, location });
    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: 'Location slug already exists.' });
        }
        console.error('[web/locations] create', error);
        res.status(500).json({ success: false, message: 'Failed to create location.' });
    }
};

exports.updateLocation = async (req, res) => {
    try {
        const { slug } = req.params;
        const { name, newSlug, parentSlug, image, description, lat, lng, sortOrder, isActive } =
            req.body;

        const existing = await prisma.location.findUnique({ where: { slug } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Location not found.' });
        }

        const data = {};
        if (name !== undefined) data.name = String(name).trim();
        if (newSlug !== undefined) data.slug = String(newSlug).trim().toLowerCase();
        if (parentSlug !== undefined) data.parentSlug = parentSlug ? String(parentSlug).trim() : null;
        if (image !== undefined) data.image = String(image).trim();
        if (description !== undefined) {
            data.description = description ? String(description).trim() : null;
        }
        if (lat !== undefined) data.lat = lat != null && lat !== '' ? parseFloat(lat) : null;
        if (lng !== undefined) data.lng = lng != null && lng !== '' ? parseFloat(lng) : null;
        if (sortOrder !== undefined) data.sortOrder = parseInt(sortOrder, 10) || 0;
        if (isActive !== undefined) data.isActive = Boolean(isActive);

        const location = await prisma.location.update({
            where: { slug },
            data,
        });

        res.json({ success: true, location });
    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: 'Location slug already exists.' });
        }
        console.error('[web/locations] update', error);
        res.status(500).json({ success: false, message: 'Failed to update location.' });
    }
};
