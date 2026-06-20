const prisma = require('./src/config/database');
async function check() {
    console.log(await prisma.user.findUnique({ where: { email: 'naushadmohd74@gmail.com' } }));
    process.exit(0);
}
check();
