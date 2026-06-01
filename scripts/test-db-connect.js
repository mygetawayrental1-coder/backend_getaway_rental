require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  await prisma.$connect();
  console.log('Database connection OK');
  const [users, properties, plans, bookings] = await Promise.all([
    prisma.user.count(),
    prisma.property.count(),
    prisma.subscriptionPlan.count(),
    prisma.booking.count(),
  ]);
  console.log({ users, properties, plans, bookings });
}

main()
  .catch((err) => {
    console.error('Connection failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
