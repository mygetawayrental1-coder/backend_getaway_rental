const { PrismaClient } = require('@prisma/client');

function isRecoverableConnectionError(error) {
    const msg = String(error?.message || '');
    return (
        error?.name === 'PrismaClientInitializationError'
        || msg.includes('Server has closed the connection')
        || msg.includes("Can't reach database server")
        || msg.includes('Connection terminated unexpectedly')
        || msg.includes('ECONNRESET')
        || error?.code === 'P1017'
    );
}

function createClient() {
    const base = new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });

    // One automatic reconnect + retry when the DB drops an idle TCP connection (common with cloud hosts).
    return base.$extends({
        query: {
            $allModels: {
                async $allOperations({ args, query }) {
                    try {
                        return await query(args);
                    } catch (e) {
                        if (!isRecoverableConnectionError(e)) {
                            throw e;
                        }
                        await base.$disconnect().catch(() => {});
                        await base.$connect();
                        return query(args);
                    }
                },
            },
        },
    });
}

const globalForPrisma = globalThis;
const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

module.exports = prisma;
