const prisma = require('../config/database');
const { verifyToken: verifyClerkJwt } = require('@clerk/backend');

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
        if (!clerkId) return null;

        const user = await prisma.user.findUnique({
            where: { clerkId },
            select: userSelect,
        });

        if (user && user.isActive === false) {
            return null;
        }

        return user;
    } catch {
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
