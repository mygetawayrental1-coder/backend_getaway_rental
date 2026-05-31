const prisma = require('../../config/database');
const {
    formatPropertiesResponse,
    getPagination,
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

function propertyLocationWhere(locationName) {
    const term = String(locationName).trim();
    return {
        status: 'Active',
        OR: [
            { location: { contains: term, mode: 'insensitive' } },
            { state: { contains: term, mode: 'insensitive' } },
        ],
    };
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
                    where: propertyLocationWhere(loc.name),
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
            where: propertyLocationWhere(location.name),
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
        const where = propertyLocationWhere(location.name);
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
