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
        images: parseJsonField(property.images),
        icalUrls: parseJsonField(property.icalUrls),
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

// Pagination helper
const getPagination = (page = 1, limit = 10) => {
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
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
    getPagination,
    formatPaginatedResponse,
};
