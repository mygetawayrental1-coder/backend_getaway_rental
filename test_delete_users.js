const prisma = require('./src/config/database');

async function deleteUsers() {
    try {
        const emailsToDelete = ['naushadmohd74@yahoo.com', 'naushadmohd74@gmail.com'];

        for (const email of emailsToDelete) {
            const user = await prisma.user.findUnique({ where: { email } });
            if (user) {
                await prisma.user.delete({ where: { email } });
                console.log(`Successfully deleted: ${email}`);
            } else {
                console.log(`User not found: ${email}`);
            }
        }

        process.exit(0);
    } catch (error) {
        console.error("Error deleting users:", error);
        process.exit(1);
    }
}

deleteUsers();
