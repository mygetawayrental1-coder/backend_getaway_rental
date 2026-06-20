const prisma = require('../config/database');
const { createClerkClient, verifyToken: verifyClerkJwt } = require('@clerk/backend');
const { syncUser } = require('../controllers/auth.controller');

/** Map Clerk Backend API user → webhook-style payload for syncUser. */
function clerkApiUserToSyncPayload(user) {
    const emailAddresses = (user.emailAddresses || []).map((e) => ({
        id: e.id,
        email_address: e.emailAddress,
    }));

    return {
        id: user.id,
        first_name: user.firstName || '',
        last_name: user.lastName || '',
        image_url: user.imageUrl || null,
        primary_email_address_id: user.primaryEmailAddressId,
        email_addresses: emailAddresses,
    };
}

const userSelect = {
    id: true,
    clerkId: true,
    email: true,
    firstName: true,
    lastName: true,
    role: true,
    isActive: true,
};

const userSelectOptional = {
    id: true,
    clerkId: true,
    email: true,
    firstName: true,
    lastName: true,
    role: true,
};

/**
 * Resolve app User from a Clerk session JWT (Bearer token).
 * The backend never issues its own tokens — clients authenticate via Clerk.
 */
async function getUserFromBearerToken(token) {
    if (!token) return null;

    if (!process.env.CLERK_SECRET_KEY) {
        console.warn('[auth] CLERK_SECRET_KEY is not set — cannot verify tokens.');
        return null;
    }

    try {
        const payload = await verifyClerkJwt(token, {
            secretKey: process.env.CLERK_SECRET_KEY,
        });
        const clerkId = payload?.sub;
        if (!clerkId) {
            console.warn('[auth] Token verified but no sub/clerkId found in payload', payload);
            return null;
        }

        let user = await prisma.user.findUnique({
            where: { clerkId },
            select: userSelect,
        });

        if (!user) {
            try {
                const clerk = createClerkClient({
                    secretKey: process.env.CLERK_SECRET_KEY,
                });
                const clerkUser = await clerk.users.getUser(clerkId);
                await syncUser(clerkApiUserToSyncPayload(clerkUser));
                user = await prisma.user.findUnique({
                    where: { clerkId },
                    select: userSelect,
                });
            } catch (provisionErr) {
                console.error(
                    '[auth] Could not provision user from Clerk:',
                    provisionErr.message,
                );
            }
        }

        if (user && user.isActive === false) {
            return null;
        }

        // Legacy END_USER accounts are property owners — normalize role in API + DB.
        if (user && user.role === 'END_USER') {
            prisma.user
                .update({ where: { id: user.id }, data: { role: 'OWNER' } })
                .catch((err) => console.warn('[auth] END_USER→OWNER upgrade failed:', err.message));
            return { ...user, role: 'OWNER' };
        }

        return user;
    } catch (error) {
        console.error('[auth] Token verification failed:', error.message);
        return null;
    }
}

async function getUserFromBearerTokenOptional(token) {
    if (!token) return null;
    return getUserFromBearerToken(token);
}

module.exports = {
    getUserFromBearerToken,
    getUserFromBearerTokenOptional,
};
