const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const email = 'mdkabir3350@gmail.com';
  
  // Find the user first
  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user) {
    console.error(`User with email ${email} not found.`);
    return;
  }

  // Update the user role to ADMIN
  const updatedUser = await prisma.user.update({
    where: { email },
    data: { role: 'ADMIN' }
  });

  console.log(`Successfully updated ${email} to ADMIN.`);
  console.log('Updated user:', updatedUser);
}

main()
  .catch((e) => {
    console.error('Error updating user:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
