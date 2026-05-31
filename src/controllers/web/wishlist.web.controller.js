const prisma = require('../../config/database');
const { formatPropertyResponse } = require('../../utils/helpers');

exports.listWishlist = async (req, res) => {
    try {
        const userId = req.user.id;

        const items = await prisma.wishlist.findMany({
            where: { userId },
            include: {
                property: {
                    include: {
                        owner: {
                            select: {
                                id: true,
                                email: true,
                                firstName: true,
                                lastName: true,
                                profilePic: true,
                                phoneNumber: true,
                            },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        const properties = items.map((w) => formatPropertyResponse(w.property)).filter(Boolean);

        res.json({ success: true, properties });
    } catch (error) {
        console.error('[web/wishlist] list', error);
        res.status(500).json({ success: false, message: 'Failed to fetch wishlist.' });
    }
};

exports.add = async (req, res) => {
    try {
        const userId = req.user.id;
        const { propertyId } = req.params;

        const property = await prisma.property.findFirst({
            where: { OR: [{ id: propertyId }, { propertyId }] },
        });
        if (!property) {
            return res.status(404).json({ success: false, message: 'Property not found.' });
        }

        await prisma.wishlist.upsert({
            where: {
                userId_propertyId: { userId, propertyId },
            },
            update: {},
            create: { userId, propertyId },
        });

        res.json({ success: true });
    } catch (error) {
        console.error('[web/wishlist] add', error);
        res.status(500).json({ success: false, message: 'Failed to add to wishlist.' });
    }
};

exports.remove = async (req, res) => {
    try {
        const userId = req.user.id;
        const { propertyId } = req.params;

        await prisma.wishlist.deleteMany({
            where: { userId, propertyId },
        });

        res.json({ success: true });
    } catch (error) {
        console.error('[web/wishlist] remove', error);
        res.status(500).json({ success: false, message: 'Failed to remove from wishlist.' });
    }
};

exports.toggle = async (req, res) => {
    try {
        const userId = req.user.id;
        const { propertyId: paramId } = req.params;

        const property = await prisma.property.findFirst({
            where: { OR: [{ id: paramId }, { propertyId: paramId }] },
        });
        if (!property) {
            return res.status(404).json({ success: false, message: 'Property not found.' });
        }

        const existing = await prisma.wishlist.findUnique({
            where: {
                userId_propertyId: { userId, propertyId: property.id },
            },
        });

        if (existing) {
            await prisma.wishlist.delete({ where: { id: existing.id } });
            return res.json({ success: true, wishlisted: false });
        }

        await prisma.wishlist.create({
            data: { userId, propertyId: property.id },
        });

        res.json({ success: true, wishlisted: true });
    } catch (error) {
        console.error('[web/wishlist] toggle', error);
        res.status(500).json({ success: false, message: 'Failed to toggle wishlist.' });
    }
};
