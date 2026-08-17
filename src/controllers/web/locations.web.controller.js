const prisma = require('../../config/database');
const {
    formatPropertiesResponse,
    getPagination,
    propertyWhereForCatalogLocation,
} = require('../../utils/helpers');
const { collectCityIdsForLocation } = require('../../utils/locationHierarchy');

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

async function propertyLocationWhere(loc) {
    const cityIds = await collectCityIdsForLocation(loc);
    return propertyWhereForCatalogLocation(loc, { activeOnly: true, cityIds });
}

exports.listLocations = async (req, res) => {
    try {
        const { type, forCards } = req.query;
        const where = { isActive: true };
        if (type) {
            where.type = String(type).toUpperCase();
        } else if (forCards === '1' || forCards === 'true') {
            where.type = 'STATE';
        }

        const locations = await prisma.location.findMany({
            where,
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        });

        const withCounts = await Promise.all(
            locations.map(async (loc) => {
                const rentalCount = await prisma.property.count({
                    where: await propertyLocationWhere(loc),
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
            where: await propertyLocationWhere(location),
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
        const where = await propertyLocationWhere(location);
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

        let properties = formatPropertiesResponse(rows);

        if (!sort || sort === 'newest') {
            const locKey = String(location.slug || location.name || '').trim().toLowerCase();
            if (locKey) {
                try {
                    const row = await prisma.siteSettings.findUnique({ where: { key: 'destination_order' } });
                    if (row) {
                        const orderData = JSON.parse(row.value);
                        const rankingIds = orderData[locKey] || orderData[locKey.replace(/\s+/g, '-')];
                        if (Array.isArray(rankingIds) && rankingIds.length) {
                            const rankMap = new Map(rankingIds.map((id, index) => [String(id), index]));
                            properties = [...properties].sort((a, b) => {
                                const rankA = rankMap.has(String(a.id)) ? rankMap.get(String(a.id)) : (rankMap.has(String(a.propertyId)) ? rankMap.get(String(a.propertyId)) : 999999);
                                const rankB = rankMap.has(String(b.id)) ? rankMap.get(String(b.id)) : (rankMap.has(String(b.propertyId)) ? rankMap.get(String(b.propertyId)) : 999999);
                                return rankA - rankB;
                            });
                        }
                    }
                } catch (err) {
                    console.error('[web/locations] destination custom order error:', err);
                }
            }
        }

        const totalPages = Math.ceil(total / pagination.limit) || 1;

        res.json({
            success: true,
            location: {
                slug: location.slug,
                name: location.name,
                type: location.type,
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
            include: { parent: { select: { id: true, name: true, slug: true, type: true } } },
        });

        const withCounts = await Promise.all(
            locations.map(async (loc) => {
                const rentalCount = await prisma.property.count({
                    where: await propertyLocationWhere(loc),
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

function normalizeType(raw) {
    const t = String(raw || '').toUpperCase();
    if (t === 'COUNTRY' || t === 'STATE' || t === 'CITY') return t;
    return null;
}

exports.createLocation = async (req, res) => {
    try {
        const {
            name,
            slug,
            parentSlug,
            parentId,
            type,
            image,
            description,
            lat,
            lng,
            sortOrder,
            isActive,
        } = req.body;

        if (!name || !slug || !image) {
            return res.status(400).json({
                success: false,
                message: 'name, slug, and image are required.',
            });
        }

        const locType = normalizeType(type) || 'CITY';
        let resolvedParentId =
            parentId != null && String(parentId).trim() !== ''
                ? parseInt(String(parentId), 10)
                : null;
        let resolvedParentSlug = parentSlug ? String(parentSlug).trim() : null;

        if (resolvedParentId) {
            const parent = await prisma.location.findUnique({ where: { id: resolvedParentId } });
            if (!parent) {
                return res.status(400).json({ success: false, message: 'Invalid parentId.' });
            }
            if (locType === 'STATE' && parent.type !== 'COUNTRY') {
                return res
                    .status(400)
                    .json({ success: false, message: 'State parent must be a Country.' });
            }
            if (locType === 'CITY' && parent.type !== 'STATE') {
                return res
                    .status(400)
                    .json({ success: false, message: 'City parent must be a State.' });
            }
            if (locType === 'COUNTRY') {
                return res
                    .status(400)
                    .json({ success: false, message: 'Country cannot have a parent.' });
            }
            resolvedParentSlug = parent.slug;
        } else if (locType === 'STATE' || locType === 'CITY') {
            return res.status(400).json({
                success: false,
                message: `${locType === 'STATE' ? 'State' : 'City'} requires a parent.`,
            });
        }

        const cleanSlug = String(slug).trim().toLowerCase();
        const existing = await prisma.location.findUnique({ where: { slug: cleanSlug } });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: `Location slug already exists (${existing.name} / ${existing.type} / id=${existing.id}).`,
                existing: {
                    id: existing.id,
                    name: existing.name,
                    slug: existing.slug,
                    type: existing.type,
                    isActive: existing.isActive,
                },
            });
        }

        const location = await prisma.location.create({
            data: {
                name: String(name).trim(),
                slug: cleanSlug,
                type: locType,
                parentId: locType === 'COUNTRY' ? null : resolvedParentId,
                parentSlug: locType === 'COUNTRY' ? null : resolvedParentSlug,
                image: String(image).trim(),
                description: description ? String(description).trim() : null,
                lat: lat != null && lat !== '' ? parseFloat(lat) : null,
                lng: lng != null && lng !== '' ? parseFloat(lng) : null,
                sortOrder: sortOrder != null ? parseInt(sortOrder, 10) : 0,
                isActive: isActive !== undefined ? Boolean(isActive) : true,
            },
        });

        res.status(201).json({ success: true, location });
    } catch (error) {
        if (error.code === 'P2002') {
            const fields = Array.isArray(error.meta?.target)
                ? error.meta.target.join(', ')
                : String(error.meta?.target || 'unknown');
            return res.status(400).json({
                success: false,
                message: `Location unique conflict on: ${fields}.`,
            });
        }
        console.error('[web/locations] create', error);
        res.status(500).json({
            success: false,
            message: error.message
                ? `Failed to create location: ${error.message}`
                : 'Failed to create location.',
        });
    }
};

exports.updateLocation = async (req, res) => {
    try {
        const { slug } = req.params;
        const {
            name,
            newSlug,
            parentSlug,
            parentId,
            type,
            image,
            description,
            lat,
            lng,
            sortOrder,
            isActive,
        } = req.body;

        const existing = await prisma.location.findUnique({ where: { slug } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Location not found.' });
        }

        const data = {};
        if (name !== undefined) data.name = String(name).trim();
        if (newSlug !== undefined) data.slug = String(newSlug).trim().toLowerCase();
        if (image !== undefined) data.image = String(image).trim();
        if (description !== undefined) {
            data.description = description ? String(description).trim() : null;
        }
        if (lat !== undefined) data.lat = lat != null && lat !== '' ? parseFloat(lat) : null;
        if (lng !== undefined) data.lng = lng != null && lng !== '' ? parseFloat(lng) : null;
        if (sortOrder !== undefined) data.sortOrder = parseInt(sortOrder, 10) || 0;
        if (isActive !== undefined) data.isActive = Boolean(isActive);

        const nextType = type !== undefined ? normalizeType(type) || existing.type : existing.type;
        if (type !== undefined) data.type = nextType;

        if (parentId !== undefined || parentSlug !== undefined || type !== undefined) {
            let resolvedParentId =
                parentId !== undefined
                    ? parentId != null && String(parentId).trim() !== ''
                        ? parseInt(String(parentId), 10)
                        : null
                    : existing.parentId;

            if (parentId === undefined && parentSlug !== undefined) {
                if (parentSlug) {
                    const p = await prisma.location.findUnique({
                        where: { slug: String(parentSlug).trim() },
                    });
                    resolvedParentId = p?.id ?? null;
                } else {
                    resolvedParentId = null;
                }
            }

            if (nextType === 'COUNTRY') {
                data.parentId = null;
                data.parentSlug = null;
            } else {
                if (!resolvedParentId) {
                    return res.status(400).json({
                        success: false,
                        message: `${nextType} requires a parent.`,
                    });
                }
                const parent = await prisma.location.findUnique({
                    where: { id: resolvedParentId },
                });
                if (!parent) {
                    return res.status(400).json({ success: false, message: 'Invalid parent.' });
                }
                if (nextType === 'STATE' && parent.type !== 'COUNTRY') {
                    return res
                        .status(400)
                        .json({ success: false, message: 'State parent must be a Country.' });
                }
                if (nextType === 'CITY' && parent.type !== 'STATE') {
                    return res
                        .status(400)
                        .json({ success: false, message: 'City parent must be a State.' });
                }
                data.parentId = parent.id;
                data.parentSlug = parent.slug;
            }
        }

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

/** DELETE /api/web/locations/:slug — Admin only */
exports.deleteLocation = async (req, res) => {
    try {
        const { slug } = req.params;
        const existing = await prisma.location.findUnique({
            where: { slug },
            include: {
                children: { select: { id: true }, take: 1 },
                properties: { select: { id: true }, take: 1 },
            },
        });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Location not found.' });
        }
        if (existing.children.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Delete or move child locations (states/cities) first.',
            });
        }
        if (existing.properties.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'This location still has properties linked. Reassign them first.',
            });
        }
        await prisma.location.delete({ where: { slug } });
        res.json({ success: true, message: 'Location deleted.' });
    } catch (error) {
        console.error('[web/locations] delete', error);
        res.status(500).json({ success: false, message: 'Failed to delete location.' });
    }
};
