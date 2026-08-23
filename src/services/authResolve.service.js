const prisma = require('../config/database');
const { createClerkClient, verifyToken: verifyClerkJwt } = require('@clerk/backend');
const { syncUser } = require('../controllers/auth.controller');
const { reconcileUserRole } = require('./subscriptionAccess.service');

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
            console.warn('[auth] Token verified but no sub/clerkId found in payload');
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
            const err = new Error('ACCOUNT_SUSPENDED');
            err.code = 'ACCOUNT_SUSPENDED';
            err.user = user;
            throw err;
        }

        // OWNER only while an active plan exists; otherwise stay USER (END_USER).
        if (user && user.role !== 'ADMIN') {
            try {
                const reconciled = await reconcileUserRole(user.id);
                if (reconciled?.role) {
                    user = { ...user, role: reconciled.role };
                }
            } catch (reconcileErr) {
                console.warn('[auth] role reconcile failed:', reconcileErr.message);
            }
        }

        return user;
    } catch (error) {
        if (error?.code === 'ACCOUNT_SUSPENDED') {
            throw error;
        }
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
