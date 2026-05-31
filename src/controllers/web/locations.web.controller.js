const prisma = require('../../config/database');

exports.listLocations = async (req, res) => {
    try {
        const locations = await prisma.location.findMany({
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        });

        const withCounts = await Promise.all(
            locations.map(async (loc) => {
                const rentalCount = await prisma.property.count({
                    where: {
                        status: 'Active',
                        OR: [
                            { location: { contains: loc.name, mode: 'insensitive' } },
                            { state: { contains: loc.name, mode: 'insensitive' } },
                        ],
                    },
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

        if (!location) {
            return res.status(404).json({ success: false, message: 'Location not found.' });
        }

        const rentalCount = await prisma.property.count({
            where: {
                status: 'Active',
                OR: [
                    { location: { contains: location.name, mode: 'insensitive' } },
                    { state: { contains: location.name, mode: 'insensitive' } },
                ],
            },
        });

        res.json({ success: true, location: { ...location, rentalCount } });
    } catch (error) {
        console.error('[web/locations] slug', error);
        res.status(500).json({ success: false, message: 'Failed to fetch location.' });
    }
};
