/**
 * Location hierarchy helpers: Country → State → City roll-up for search/SEO.
 */
const prisma = require('../config/database');

/**
 * Collect CITY location ids under a catalog row (inclusive if already a city).
 */
async function collectCityIdsForLocation(loc, client = prisma) {
    if (!loc?.id) return [];

    const type = loc.type || null;
    if (type === 'CITY') return [loc.id];

    // Legacy rows without type: treat as leaf (old behavior) until backfill runs
    if (!type) return [loc.id];

    if (type === 'STATE') {
        const cities = await client.location.findMany({
            where: { parentId: loc.id, type: 'CITY', isActive: true },
            select: { id: true },
        });
        const ids = cities.map((c) => c.id);
        // also include direct FK to state for legacy mis-binds until cleaned
        return ids.length ? ids : [loc.id];
    }

    if (type === 'COUNTRY') {
        const states = await client.location.findMany({
            where: { parentId: loc.id, type: 'STATE' },
            select: { id: true },
        });
        const stateIds = states.map((s) => s.id);
        const cities = await client.location.findMany({
            where: {
                OR: [
                    { parentId: loc.id, type: 'CITY' },
                    ...(stateIds.length
                        ? [{ parentId: { in: stateIds }, type: 'CITY' }]
                        : []),
                ],
                isActive: true,
            },
            select: { id: true },
        });
        const ids = cities.map((c) => c.id);
        return ids.length ? ids : [loc.id];
    }

    return [loc.id];
}

/**
 * Resolve ancestors for a CITY (or any node).
 */
async function getLocationAncestors(loc, client = prisma) {
    const chain = { city: null, state: null, country: null };
    if (!loc) return chain;

    let current = loc;
    if (current.type === 'CITY') {
        chain.city = current;
        if (current.parentId) {
            current = await client.location.findUnique({ where: { id: current.parentId } });
        } else current = null;
    }
    if (current?.type === 'STATE') {
        chain.state = current;
        if (current.parentId) {
            current = await client.location.findUnique({ where: { id: current.parentId } });
        } else current = null;
    }
    if (current?.type === 'COUNTRY') {
        chain.country = current;
    }
    return chain;
}

/**
 * Sync property location fields from a CITY catalog row.
 */
async function syncPropertyFieldsFromCity(city, client = prisma) {
    if (!city || city.type !== 'CITY') {
        throw new Error('locationId must reference a CITY');
    }
    const { state, country } = await getLocationAncestors(city, client);
    return {
        locationId: city.id,
        location: city.name,
        state: state?.name || null,
        country: country?.name || 'United States',
        latitude: city.lat != null ? String(city.lat) : undefined,
        longitude: city.lng != null ? String(city.lng) : undefined,
    };
}

module.exports = {
    collectCityIdsForLocation,
    getLocationAncestors,
    syncPropertyFieldsFromCity,
};
