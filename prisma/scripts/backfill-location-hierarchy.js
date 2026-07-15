/**
 * Backfill Location.type + parentId from parentSlug, then fix Property.locationId
 * so only CITY rows remain bound. Run: node prisma/scripts/backfill-location-hierarchy.js
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/** Known US state slugs that may have no child cities yet */
const FORCE_STATE_SLUGS = new Set([
  'california',
  'nevada',
  'new-jersey',
  'virginia',
  'new-york',
  'texas',
  'florida',
  'hawaii',
  'arizona',
  'colorado',
  'washington',
  'oregon',
]);

async function main() {
  const all = await prisma.location.findMany();
  const bySlug = new Map(all.map((l) => [l.slug, l]));

  for (const loc of all) {
    let parentId = null;
    if (loc.parentSlug && bySlug.has(loc.parentSlug)) {
      parentId = bySlug.get(loc.parentSlug).id;
    }
    if (loc.parentId !== parentId) {
      await prisma.location.update({
        where: { id: loc.id },
        data: { parentId },
      });
      loc.parentId = parentId;
    }
  }

  const refreshed = await prisma.location.findMany();
  const childCount = new Map();
  for (const loc of refreshed) {
    if (loc.parentId != null) {
      childCount.set(loc.parentId, (childCount.get(loc.parentId) || 0) + 1);
    }
  }

  for (const loc of refreshed) {
    let type = 'CITY';
    if (loc.parentId == null && !loc.parentSlug) {
      type = 'COUNTRY';
    } else if ((childCount.get(loc.id) || 0) > 0 || FORCE_STATE_SLUGS.has(loc.slug)) {
      type = 'STATE';
    } else {
      type = 'CITY';
    }
    if (loc.parentId == null && !loc.parentSlug) type = 'COUNTRY';

    await prisma.location.update({
      where: { id: loc.id },
      data: { type },
    });
  }

  const us = await prisma.location.findFirst({ where: { slug: 'united-states' } });
  const nyc = await prisma.location.findFirst({ where: { slug: 'new-york-city' } });
  if (us && nyc) {
    let nyState = await prisma.location.findFirst({ where: { slug: 'new-york' } });
    if (!nyState) {
      nyState = await prisma.location.create({
        data: {
          name: 'New York',
          slug: 'new-york',
          type: 'STATE',
          parentId: us.id,
          parentSlug: us.slug,
          image: nyc.image || us.image,
          sortOrder: (nyc.sortOrder || 4) - 1,
          isActive: true,
        },
      });
      console.log('Created state New York');
    }
    if (nyc.parentId !== nyState.id || nyc.type !== 'CITY') {
      await prisma.location.update({
        where: { id: nyc.id },
        data: {
          type: 'CITY',
          parentId: nyState.id,
          parentSlug: nyState.slug,
        },
      });
      console.log('Reparented New York City under New York state');
    }
  }

  const locations = await prisma.location.findMany();
  const byId = new Map(locations.map((l) => [l.id, l]));

  function ancestors(loc) {
    const chain = { city: null, state: null, country: null };
    if (!loc) return chain;
    if (loc.type === 'CITY') {
      chain.city = loc;
      const st = loc.parentId ? byId.get(loc.parentId) : null;
      chain.state = st || null;
      const co = st?.parentId ? byId.get(st.parentId) : null;
      chain.country = co || null;
    } else if (loc.type === 'STATE') {
      chain.state = loc;
      chain.country = loc.parentId ? byId.get(loc.parentId) : null;
    } else {
      chain.country = loc;
    }
    return chain;
  }

  const props = await prisma.property.findMany({
    where: { locationId: { not: null } },
  });

  let remapped = 0;
  let cleared = 0;
  let synced = 0;

  for (const p of props) {
    const loc = byId.get(p.locationId);
    if (!loc) {
      await prisma.property.update({
        where: { id: p.id },
        data: { locationId: null },
      });
      cleared += 1;
      continue;
    }

    if (loc.type === 'CITY') {
      const { city, state, country } = ancestors(loc);
      await prisma.property.update({
        where: { id: p.id },
        data: {
          location: city?.name || p.location,
          state: state?.name || p.state,
          country: country?.name || p.country || 'United States',
          latitude: city?.lat != null ? String(city.lat) : p.latitude,
          longitude: city?.lng != null ? String(city.lng) : p.longitude,
        },
      });
      synced += 1;
      continue;
    }

    const name = String(p.location || '').trim().toLowerCase();
    let city = null;
    if (name) {
      const candidates = locations.filter((l) => l.type === 'CITY');
      city = candidates.find((c) => c.name.toLowerCase() === name) || null;
      if (city && loc.type === 'STATE') {
        const under = candidates.find(
          (c) => c.parentId === loc.id && c.name.toLowerCase() === name,
        );
        if (under) city = under;
        else if (city.parentId !== loc.id) city = null;
      }
    }

    if (!city && loc.type === 'STATE') {
      const kids = locations.filter((l) => l.type === 'CITY' && l.parentId === loc.id);
      if (kids.length === 1) city = kids[0];
    }

    if (city) {
      const chain = ancestors(city);
      await prisma.property.update({
        where: { id: p.id },
        data: {
          locationId: city.id,
          location: chain.city.name,
          state: chain.state?.name || p.state,
          country: chain.country?.name || p.country || 'United States',
          latitude: city.lat != null ? String(city.lat) : p.latitude,
          longitude: city.lng != null ? String(city.lng) : p.longitude,
        },
      });
      remapped += 1;
    } else {
      await prisma.property.update({
        where: { id: p.id },
        data: { locationId: null },
      });
      cleared += 1;
      console.log(
        `Cleared locationId on property ${p.propertyId || p.id} (was ${loc.type} ${loc.name})`,
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        locations: locations.length,
        propertiesSynced: synced,
        propertiesRemapped: remapped,
        propertiesClearedBadFk: cleared,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
