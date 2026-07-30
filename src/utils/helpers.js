// Parse JSON string to array/object safely
const parseJsonField = (field) => {
    if (!field) return null;
    try {
        return JSON.parse(field);
    } catch {
        return field;
    }
};

// Stringify array/object to JSON for storage
const stringifyJsonField = (field) => {
    if (!field) return null;
    if (typeof field === 'string') return field;
    return JSON.stringify(field);
};

// Format property response (parse JSON fields)
const formatPropertyResponse = (property) => {
    if (!property) return null;
    return {
        ...property,
        additionalCharges: parseJsonField(property.additionalCharges),
        amenities: parseJsonField(property.amenities),
        suitability: parseJsonField(property.suitability),
        images: parseJsonField(property.images),
        icalUrls: parseJsonField(property.icalUrls),
        customFields: parseJsonField(property.customFields),
        socialMediaUrls: parseJsonField(property.socialMediaUrls),
    };
};

// Format properties array
const formatPropertiesResponse = (properties) => {
    return properties.map(formatPropertyResponse);
};

// Calculate total nights between dates
const calculateNights = (checkin, checkout) => {
    if (!checkin || !checkout) return null;
    const start = new Date(checkin);
    const end = new Date(checkout);
    const diffTime = Math.abs(end - start);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

/** Prisma `where` fragment for location_name search (city, state, or country). */
function buildLocationFilter(term) {
    const raw = String(term).trim();
    if (!raw) return null;

    const lower = raw.toLowerCase();
    const isUnitedStates = [
        'united states',
        'united states of america',
        'usa',
        'u.s.a.',
        'u.s.',
        'us',
        'america',
    ].includes(lower);

    if (isUnitedStates) {
        return {
            OR: [
                { country: { equals: 'USA', mode: 'insensitive' } },
                { country: { equals: 'US', mode: 'insensitive' } },
                { country: { contains: 'United States', mode: 'insensitive' } },
            ],
        };
    }

    return {
        OR: [
            { location: { contains: raw, mode: 'insensitive' } },
            { state: { contains: raw, mode: 'insensitive' } },
            { country: { contains: raw, mode: 'insensitive' } },
        ],
    };
}

/**
 * Prefer FK binding with hierarchy roll-up; keep string contains for legacy rows.
 * `loc` = Location row { id, name, type? }
 * `cityIds` = optional precomputed descendant city ids (from collectCityIdsForLocation)
 */
function propertyWhereForCatalogLocation(loc, { activeOnly = true, cityIds = null } = {}) {
    if (!loc?.id) return null;
    const name = String(loc.name || '').trim();
    const ids =
        Array.isArray(cityIds) && cityIds.length > 0 ? cityIds : [loc.id];

    const or = [{ locationId: { in: ids } }];
    if (name) {
        or.push({ location: { contains: name, mode: 'insensitive' } });
        or.push({ state: { contains: name, mode: 'insensitive' } });
        if (loc.type === 'COUNTRY') {
            or.push({ country: { contains: name, mode: 'insensitive' } });
        }
    }
    const where = { OR: or };
    if (activeOnly) where.status = 'Active';
    return where;
}

// Pagination helper. Pass maxLimit for admin bulk lists (SEO / owners).
const getPagination = (page = 1, limit = 10, { maxLimit = 100 } = {}) => {
    let parsedPage = 1;
    if (typeof page === 'string' || typeof page === 'number') {
        parsedPage = parseInt(page);
    } else if (Array.isArray(page) && page.length > 0) {
        parsedPage = parseInt(page[0]);
    }
    const pageNum = isNaN(parsedPage) ? 1 : Math.max(1, parsedPage);

    let parsedLimit = 10;
    if (typeof limit === 'string' || typeof limit === 'number') {
        parsedLimit = parseInt(limit);
    } else if (Array.isArray(limit) && limit.length > 0) {
        parsedLimit = parseInt(limit[0]);
    }
    const cap = Number.isFinite(maxLimit) && maxLimit > 0 ? maxLimit : 100;
    const limitNum = isNaN(parsedLimit) ? 10 : Math.min(cap, Math.max(1, parsedLimit));

    const skip = (pageNum - 1) * limitNum;
    return { skip, take: limitNum, page: pageNum, limit: limitNum };
};

// Format pagination response
const formatPaginatedResponse = (data, total, page, limit) => {
    return {
        data,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasMore: page * limit < total,
        },
    };
};

module.exports = {
    parseJsonField,
    stringifyJsonField,
    formatPropertyResponse,
    formatPropertiesResponse,
    calculateNights,
    buildLocationFilter,
    propertyWhereForCatalogLocation,
    getPagination,
    formatPaginatedResponse,
};
