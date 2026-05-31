const prisma = require('../../config/database');
const {
    formatPropertyResponse,
    formatPropertiesResponse,
    getPagination,
} = require('../../utils/helpers');

async function enrichWithReviewStats(properties) {
    const ids = properties.map((p) => p.id);
    if (!ids.length) return [];

    const grouped = await prisma.review.groupBy({
        by: ['propertyId'],
        where: { propertyId: { in: ids }, isApproved: true },
        _avg: { overallRating: true },
        _count: { id: true },
    });

    const map = Object.fromEntries(
        grouped.map((g) => [g.propertyId, { avg: g._avg.overallRating, count: g._count.id }]),
    );

    return formatPropertiesResponse(properties).map((p) => {
        const r = map[p.id];
        return {
            ...p,
            averageRating: r?.avg ?? null,
            reviewCount: r?.count ?? 0,
        };
    });
}

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

/** GET /api/web/properties */
exports.searchProperties = async (req, res) => {
    try {
        const {
            location_name,
            check_in,
            check_out,
            guests,
            adults,
            children,
            price_min,
            price_max,
            rental_type,
            amenities,
            sort,
            page,
            limit,
            bedrooms,
        } = req.query;

        const pagination = getPagination(page, limit);

        const where = {
            status: 'Active',
        };

        const andConditions = [];

        if (location_name) {
            const term = String(location_name).trim();
            andConditions.push({
                OR: [
                    { location: { contains: term, mode: 'insensitive' } },
                    { state: { contains: term, mode: 'insensitive' } },
                    { country: { contains: term, mode: 'insensitive' } },
                ],
            });
        }

        if (rental_type) {
            const types = String(rental_type)
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            if (types.length === 1) {
                andConditions.push({ rentalType: types[0] });
            } else if (types.length > 1) {
                andConditions.push({ OR: types.map((t) => ({ rentalType: t })) });
            }
        }

        const guestsNum = guests ? parseInt(guests, 10) : null;
        const adultsNum = adults ? parseInt(adults, 10) : 0;
        const childrenNum = children ? parseInt(children, 10) : 0;
        let minCapacity = null;
        if (guestsNum && !Number.isNaN(guestsNum)) {
            minCapacity = guestsNum;
        } else if (adultsNum || childrenNum) {
            const sum = (Number.isNaN(adultsNum) ? 0 : adultsNum) + (Number.isNaN(childrenNum) ? 0 : childrenNum);
            if (sum > 0) minCapacity = sum;
        }
        if (minCapacity && minCapacity > 0) {
            where.guests = { gte: minCapacity };
        }

        const bedN = bedrooms ? parseInt(String(bedrooms), 10) : null;
        if (bedN && !Number.isNaN(bedN) && bedN > 0) {
            andConditions.push({ bedrooms: { gte: bedN } });
        }

        const minP = price_min ? parseInt(price_min, 10) : null;
        const maxP = price_max ? parseInt(price_max, 10) : null;
        if (minP !== null && !Number.isNaN(minP)) {
            where.nightlyRate = { ...(where.nightlyRate || {}), gte: minP };
        }
        if (maxP !== null && !Number.isNaN(maxP)) {
            where.nightlyRate = { ...(where.nightlyRate || {}), lte: maxP };
        }

        if (amenities) {
            const list = String(amenities)
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            list.forEach((a) => {
                andConditions.push({ amenities: { contains: a, mode: 'insensitive' } });
            });
        }

        if (andConditions.length) {
            where.AND = andConditions;
        }

        let excludeIds = [];
        if (check_in && check_out) {
            const start = new Date(check_in);
            const end = new Date(check_out);
            if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start < end) {
                const overlapping = await prisma.booking.findMany({
                    where: {
                        status: 'CONFIRMED',
                        AND: [{ checkin: { lt: end } }, { checkout: { gt: start } }],
                    },
                    select: { propertyId: true },
                });
                excludeIds = [...new Set(overlapping.map((b) => b.propertyId))];
            }
        }

        if (excludeIds.length) {
            where.id = { notIn: excludeIds };
        }

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

        const properties = await enrichWithReviewStats(rows);

        const totalPages = Math.ceil(total / pagination.limit) || 1;

        res.json({
            success: true,
            properties,
            total,
            page: pagination.page,
            totalPages,
        });
    } catch (error) {
        console.error('[web/properties] search', error);
        res.status(500).json({ success: false, message: 'Failed to fetch properties.' });
    }
};

/** GET /api/web/properties/featured */
exports.getFeatured = async (req, res) => {
    try {
        const rows = await prisma.property.findMany({
            where: {
                status: 'Active',
                isFeatured: true,
            },
            take: 12,
            orderBy: { createdAt: 'desc' },
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
        });

        const properties = await enrichWithReviewStats(rows);
        res.json({ success: true, properties });
    } catch (error) {
        console.error('[web/properties] featured', error);
        res.status(500).json({ success: false, message: 'Failed to fetch featured properties.' });
    }
};

/** GET /api/web/properties/slug/:slug */
exports.getBySlug = async (req, res) => {
    try {
        const { slug } = req.params;

        const property = await prisma.property.findFirst({
            where: { slug },
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
                reviews: {
                    where: { isApproved: true },
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        authorName: true,
                        authorEmail: true,
                        sleepRating: true,
                        locationRating: true,
                        serviceRating: true,
                        clearnessRating: true,
                        roomsRating: true,
                        overallRating: true,
                        text: true,
                        ownerReply: true,
                        ownerRepliedAt: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                },
            },
        });

        if (!property || property.status !== 'Active') {
            return res.status(404).json({ success: false, message: 'Property not found.' });
        }

        const agg = await prisma.review.aggregate({
            where: { propertyId: property.id, isApproved: true },
            _avg: { overallRating: true },
            _count: { id: true },
        });

        const formatted = formatPropertyResponse(property);
        res.json({
            success: true,
            data: {
                ...formatted,
                reviews: property.reviews,
                averageRating: agg._avg.overallRating,
                reviewCount: agg._count.id,
            },
        });
    } catch (error) {
        console.error('[web/properties] slug', error);
        res.status(500).json({ success: false, message: 'Failed to fetch property.' });
    }
};

/** GET /api/web/properties/:id/reviews */
exports.getReviews = async (req, res) => {
    try {
        const { id } = req.params;
        const approvedOnly = req.query.approvedOnly !== 'false';

        const property = await prisma.property.findFirst({
            where: { OR: [{ id }, { propertyId: id }] },
            select: { id: true },
        });
        if (!property) {
            return res.status(404).json({ success: false, message: 'Property not found.' });
        }

        const where = { propertyId: property.id };
        if (approvedOnly) where.isApproved = true;

        const reviews = await prisma.review.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                authorName: true,
                authorEmail: true,
                sleepRating: true,
                locationRating: true,
                serviceRating: true,
                clearnessRating: true,
                roomsRating: true,
                overallRating: true,
                text: true,
                ownerReply: true,
                ownerRepliedAt: true,
                isApproved: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        res.json({ success: true, reviews });
    } catch (error) {
        console.error('[web/properties] reviews get', error);
        res.status(500).json({ success: false, message: 'Failed to fetch reviews.' });
    }
};

/** POST /api/web/properties/:id/reviews */
exports.createReview = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            authorName,
            authorEmail,
            sleepRating,
            locationRating,
            serviceRating,
            clearnessRating,
            roomsRating,
            text,
        } = req.body;

        const property = await prisma.property.findFirst({
            where: { OR: [{ id }, { propertyId: id }] },
        });
        if (!property) {
            return res.status(404).json({ success: false, message: 'Property not found.' });
        }

        const nums = [sleepRating, locationRating, serviceRating, clearnessRating, roomsRating].map((n) =>
            parseInt(n, 10),
        );
        if (nums.some((n) => Number.isNaN(n) || n < 1 || n > 5)) {
            return res.status(400).json({ success: false, message: 'Each rating must be between 1 and 5.' });
        }

        const overallRating = nums.reduce((a, b) => a + b, 0) / nums.length;

        const review = await prisma.review.create({
            data: {
                propertyId: property.id,
                authorId: req.user?.id ?? null,
                authorName: String(authorName || '').trim() || 'Guest',
                authorEmail: String(authorEmail || '').trim(),
                sleepRating: nums[0],
                locationRating: nums[1],
                serviceRating: nums[2],
                clearnessRating: nums[3],
                roomsRating: nums[4],
                overallRating,
                text: String(text || '').trim(),
                isApproved: false,
            },
        });

        res.status(201).json({ success: true, review });
    } catch (error) {
        console.error('[web/properties] reviews post', error);
        res.status(500).json({ success: false, message: 'Failed to create review.' });
    }
};

/** GET /api/web/properties/:id/bookings — blocked dates for calendar */
exports.getPropertyBookings = async (req, res) => {
    try {
        const { id } = req.params;

        const property = await prisma.property.findFirst({
            where: { OR: [{ id }, { propertyId: id }] },
            select: { id: true },
        });
        if (!property) {
            return res.status(404).json({ success: false, message: 'Property not found.' });
        }

        const bookings = await prisma.booking.findMany({
            where: {
                propertyId: property.id,
                status: { in: ['CONFIRMED', 'ONGOING'] },
            },
            select: {
                checkin: true,
                checkout: true,
            },
            orderBy: { checkin: 'asc' },
        });

        res.json({ success: true, bookings });
    } catch (error) {
        console.error('[web/properties] bookings', error);
        res.status(500).json({ success: false, message: 'Failed to fetch bookings.' });
    }
};
