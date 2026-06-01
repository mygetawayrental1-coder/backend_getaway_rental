require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const [users, properties, active, featured, locations, plans] = await Promise.all([
    prisma.user.count(),
    prisma.property.count(),
    prisma.property.count({ where: { status: 'Active' } }),
    prisma.property.count({ where: { status: 'Active', isFeatured: true } }),
    prisma.location.count(),
    prisma.subscriptionPlan.count(),
  ]);

  console.log('DATABASE_URL host:', (process.env.DATABASE_URL || '').replace(/:[^:@]+@/, ':****@'));
  console.log({
    users,
    properties,
    activeProperties: active,
    featuredActive: featured,
    locations,
    subscriptionPlans: plans,
  });

  const sample = await prisma.property.findMany({
    where: { status: 'Active', isFeatured: true },
    take: 5,
    select: { id: true, propertyName: true, slug: true, status: true, isFeatured: true },
  });
  console.log('\nSample featured Active properties:');
  console.log(sample.length ? sample : '(none)');

  const statusBreakdown = await prisma.property.groupBy({
    by: ['status'],
    _count: true,
  });
  console.log('\nProperty status breakdown:');
  console.log(statusBreakdown);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
