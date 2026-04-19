require('dotenv').config();
const prisma = require('./src/config/database');
const app = require('./src/app');

const PORT = process.env.PORT || 5000;

async function connectWithRetry(attempts = 5, delayMs = 2500) {
    let lastErr;
    for (let i = 0; i < attempts; i += 1) {
        try {
            await prisma.$connect();
            if (i > 0) {
                console.log(`✓ Database connected after ${i + 1} attempts`);
            }
            return;
        } catch (err) {
            lastErr = err;
            console.warn(`Database connect attempt ${i + 1}/${attempts}: ${err.message}`);
            if (i < attempts - 1) {
                await new Promise((r) => setTimeout(r, delayMs));
            }
        }
    }
    throw lastErr;
}

async function bootstrap() {
    try {
        await connectWithRetry();
        console.log('✓ Database connection OK');
    } catch (err) {
        console.error('✗ Database connection failed after retries.');
        console.error(err.message);
        console.error(`
Hints:
  • Local Postgres: ensure the service is running and DATABASE_URL host/port/user/password/db name match.
  • Cloud (Neon, Supabase, Render, etc.): use the provider connection string; often add ?sslmode=require
  • If the DB sleeps (free tier), wait and restart the server or run: npx prisma db pull (to verify URL)
`);
        process.exit(1);
    }

    const server = app.listen(PORT, () => {
        console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🚀 MyGatewayRental API Server                            ║
║                                                            ║
║   Server running on: http://localhost:${PORT}                ║
║   Environment: ${process.env.NODE_ENV || 'development'}                            ║
║                                                            ║
║   Endpoints:                                               ║
║   • Auth:          /auth                                   ║
║   • Properties:    /properties                             ║
║   • Inquiries:     /inquiries                              ║
║   • Users:         /users                                  ║
║   • Owners:        /owners                                 ║
║   • Subscriptions: /subscriptions                          ║
║   • Payments:      /payments                               ║
║   • Uploads:       /uploads                          ║
║   • Dashboard:     /dashboard                             ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
    });

    const shutdown = (signal) => {
        console.log(`\n${signal} received, closing...`);
        server.close(async () => {
            await prisma.$disconnect().catch(() => {});
            process.exit(0);
        });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap();
