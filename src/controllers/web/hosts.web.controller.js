const prisma = require('../../config/database');
const { formatPropertiesResponse } = require('../../utils/helpers');

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
