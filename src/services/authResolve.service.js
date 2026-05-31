const prisma = require('../config/database');
const { verifyToken: verifyLegacyJwt } = require('./token.service');
const { verifyToken: verifyClerkJwt } = require('@clerk/backend');

const userSelect = {
    id: true,
    email: true,
    firstName: true,
    lastName: true,
    role: true,
    emailVerified: true,
};

const userSelectOptional = {
    id: true,
    email: true,
    firstName: true,
    lastName: true,
    role: true,
};

/**
 * Resolve app User from Authorization Bearer token.
 * Supports legacy JWT (admin portal / mobile) and Clerk session JWT (Next.js / Flutter).
 */
async function getUserFromBearerToken(token) {
    if (!token) return null;

    const legacy = verifyLegacyJwt(token);
    if (legacy?.userId) {
        const user = await prisma.user.findUnique({
            where: { id: legacy.userId },
            select: userSelect,
        });
        if (user) return user;
    }

    if (!process.env.CLERK_SECRET_KEY) return null;

    try {
        const payload = await verifyClerkJwt(token, {
            secretKey: process.env.CLERK_SECRET_KEY,
        });
        const clerkId = payload?.sub;
        if (clerkId) {
            const user = await prisma.user.findUnique({
                where: { clerkId },
                select: userSelect,
            });
            if (user) return user;
        }
    } catch {
        // Not a valid Clerk token
    }

    return null;
}

async function getUserFromBearerTokenOptional(token) {
    if (!token) return null;

    const legacy = verifyLegacyJwt(token);
    if (legacy?.userId) {
        const user = await prisma.user.findUnique({
            where: { id: legacy.userId },
            select: userSelectOptional,
        });
        if (user) return user;
    }

    if (!process.env.CLERK_SECRET_KEY) return null;

    try {
        const payload = await verifyClerkJwt(token, {
            secretKey: process.env.CLERK_SECRET_KEY,
        });
        const clerkId = payload?.sub;
        if (clerkId) {
            const user = await prisma.user.findUnique({
                where: { clerkId },
                select: userSelectOptional,
            });
            if (user) return user;
        }
    } catch {
        // ignore
    }

    return null;
}

module.exports = {
    getUserFromBearerToken,
    getUserFromBearerTokenOptional,
};
