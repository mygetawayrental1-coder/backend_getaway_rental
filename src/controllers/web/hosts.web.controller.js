const prisma = require('../../config/database');
const { formatPropertiesResponse, getPagination, formatPaginatedResponse } = require('../../utils/helpers');

/** GET /api/web/hosts/:userId — public host profile + active listings */
exports.getHostProfile = async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                profilePic: true,
                about: true,
                role: true,
            },
        });

        if (!user || user.role === 'END_USER') {
            return res.status(404).json({ success: false, message: 'Host not found.' });
        }

        const properties = await prisma.property.findMany({
            where: { ownerId: userId, status: 'Active' },
            orderBy: { createdAt: 'desc' },
            take: 24,
            include: {
                owner: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        profilePic: true,
                    },
                },
            },
        });

        res.json({
            success: true,
            host: {
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                profilePic: user.profilePic,
                about: user.about,
            },
            properties: formatPropertiesResponse(properties),
        });
    } catch (error) {
        console.error('[web/hosts]', error);
        res.status(500).json({ success: false, message: 'Failed to load host.' });
    }
};

/** GET /api/web/hosts/:userId/reviews */
exports.getHostReviews = async (req, res) => {
    try {
        const { userId } = req.params;
        const { page, limit } = req.query;
        const pagination = getPagination(page, limit);

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, role: true },
        });

        if (!user || user.role === 'END_USER') {
            return res.status(404).json({ success: false, message: 'Host not found.' });
        }

        const where = {
            isApproved: true,
            property: { ownerId: userId },
        };

        const [reviews, total] = await Promise.all([
            prisma.review.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: pagination.skip,
                take: pagination.take,
                include: {
                    property: {
                        select: {
                            id: true,
                            propertyId: true,
                            propertyName: true,
                            slug: true,
                        },
                    },
                },
            }),
            prisma.review.count({ where }),
        ]);

        res.json({
            success: true,
            ...formatPaginatedResponse(reviews, total, pagination.page, pagination.limit),
        });
    } catch (error) {
        console.error('[web/hosts] reviews', error);
        res.status(500).json({ success: false, message: 'Failed to fetch host reviews.' });
    }
};
