/**
 * Create (or update) a Clerk user + Prisma ADMIN for demo login.
 * Usage: node scripts/create_demo_admin.js
 *
 * Credentials:
 *   email:    demo@mygetawayrental.com
 *   password: DemoAdmin123!
 */
require('dotenv').config();
const { createClerkClient } = require('@clerk/backend');
const { PrismaClient } = require('@prisma/client');

const EMAIL = 'demo@mygetawayrental.com';
const PASSWORD = 'DemoAdmin123!';
const FIRST = 'Demo';
const LAST = 'Admin';

const prisma = new PrismaClient();

async function main() {
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error('CLERK_SECRET_KEY is missing in .env');
  }

  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

  let clerkUser = null;
  const existing = await clerk.users.getUserList({
    emailAddress: [EMAIL],
    limit: 1,
  });

  if (existing?.data?.length) {
    clerkUser = existing.data[0];
    console.log(`Clerk user already exists: ${clerkUser.id}`);
    await clerk.users.updateUser(clerkUser.id, {
      password: PASSWORD,
      firstName: FIRST,
      lastName: LAST,
      skipPasswordChecks: true,
    });
    console.log('Password reset on existing Clerk user.');
  } else {
    clerkUser = await clerk.users.createUser({
      emailAddress: [EMAIL],
      password: PASSWORD,
      firstName: FIRST,
      lastName: LAST,
      skipPasswordChecks: true,
      skipPasswordRequirement: false,
    });
    console.log(`Created Clerk user: ${clerkUser.id}`);
  }

  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: {
      clerkId: clerkUser.id,
      firstName: FIRST,
      lastName: LAST,
      role: 'ADMIN',
      isActive: true,
    },
    create: {
      clerkId: clerkUser.id,
      email: EMAIL,
      firstName: FIRST,
      lastName: LAST,
      role: 'ADMIN',
      isActive: true,
    },
  });

  console.log('Prisma ADMIN ready:', {
    id: user.id,
    email: user.email,
    role: user.role,
    clerkId: user.clerkId,
  });
  console.log('\nLogin at admin portal with:');
  console.log(`  Email:    ${EMAIL}`);
  console.log(`  Password: ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
