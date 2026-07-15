/**
 * Smoke-test location hierarchy helpers used by create/edit flows.
 * Run: node prisma/scripts/verify-location-hierarchy.js
 */
const { PrismaClient } = require('@prisma/client');
const {
  collectCityIdsForLocation,
  syncPropertyFieldsFromCity,
} = require('../../src/utils/locationHierarchy');

const prisma = new PrismaClient();

async function main() {
  const california = await prisma.location.findFirst({ where: { slug: 'california' } });
  const la = await prisma.location.findFirst({ where: { slug: 'los-angeles' } });
  const us = await prisma.location.findFirst({ where: { slug: 'united-states' } });

  if (!california || !la || !us) throw new Error('Missing seed locations');

  const caCities = await collectCityIdsForLocation(california);
  const usCities = await collectCityIdsForLocation(us);
  const laCities = await collectCityIdsForLocation(la);
  const synced = await syncPropertyFieldsFromCity(la);

  let syncStateReject = false;
  try {
    await syncPropertyFieldsFromCity(california);
  } catch {
    syncStateReject = true;
  }

  const nonCityBound = await prisma.property.count({
    where: {
      locationId: { not: null },
      NOT: { catalogLocation: { type: 'CITY' } },
    },
  });

  const result = {
    californiaRollupCityIds: caCities,
    usRollupCount: usCities.length,
    laOnly: laCities,
    syncedFromLa: synced,
    stateSyncRejected: syncStateReject,
    propertiesBoundToNonCity: nonCityBound,
    ok:
      caCities.includes(la.id) &&
      laCities.length === 1 &&
      laCities[0] === la.id &&
      synced.location === 'Los Angeles' &&
      synced.state === 'California' &&
      synced.country === 'United States' &&
      syncStateReject === true &&
      nonCityBound === 0,
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
