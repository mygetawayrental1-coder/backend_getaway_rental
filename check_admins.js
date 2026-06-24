require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const adminCount = await prisma.user.count({
      where: {
        role: 'ADMIN',
      },
    });
    
    const admins = await prisma.user.findMany({
      where: {
        role: 'ADMIN',
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      }
    });

    console.log(`Total ADMIN users: ${adminCount}`);
    if (adminCount > 0) {
      console.log('Admins:');
      console.table(admins);
    }
  } catch (error) {
    console.error('Error querying admins:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
