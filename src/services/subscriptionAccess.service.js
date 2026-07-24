const prisma = require('../config/database');

/** Active paid subscription for listing properties. */
async function getActiveSubscription(userId) {
    if (!userId) return null;

    return prisma.userSubscription.findFirst({
        where: {
            userId,
            status: 'ACTIVE',
        },
        include: {
            plan: true,
        },
        orderBy: { createdAt: 'desc' },
    });
}

async function countOwnerProperties(userId) {
    return prisma.property.count({ where: { ownerId: userId } });
}

/**
 * Whether the user may create another listing under their plan.
 */
async function assertCanCreateListing(userId) {
    const subscription = await getActiveSubscription(userId);
    if (!subscription) {
        return {
            allowed: false,
            status: 403,
            message:
                'An active subscription is required to list properties. Choose a plan on the pricing page.',
        };
    }

    const listingCount = await countOwnerProperties(userId);
    const max = subscription.plan.maxProperties ?? 1;

    if (listingCount >= max) {
        return {
            allowed: false,
            status: 403,
            message: `Your ${subscription.plan.name} plan allows up to ${max} listing(s). Upgrade your plan to add more.`,
            subscription,
            listingCount,
            maxProperties: max,
        };
    }

    return {
        allowed: true,
        subscription,
        listingCount,
        maxProperties: max,
        remaining: max - listingCount,
    };
}

async function getSubscriptionSummary(userId) {
    const subscription = await getActiveSubscription(userId);
    const listingCount = await countOwnerProperties(userId);
    const maxProperties = subscription?.plan?.maxProperties ?? 0;

    return {
        hasActiveSubscription: Boolean(subscription),
        subscription: subscription
            ? {
                  id: subscription.id,
                  status: subscription.status,
                  endDate: subscription.endDate,
                  planId: subscription.planId,
                  planName: subscription.plan.name,
                  maxProperties,
              }
            : null,
        listingCount,
        canListProperties: Boolean(
            subscription && listingCount < maxProperties,
        ),
        remainingListings: subscription
            ? Math.max(0, maxProperties - listingCount)
            : 0,
    };
}

/**
 * OWNER = has an active paid/admin plan.
 * Fresh signups and users without a plan stay END_USER (shown as USER in admin).
 * Never changes ADMIN.
 */
async function reconcileUserRole(userId) {
    if (!userId) return null;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true },
    });
    if (!user || user.role === 'ADMIN') return user;

    const subscription = await getActiveSubscription(userId);

    if (subscription && user.role !== 'OWNER') {
        return prisma.user.update({
            where: { id: userId },
            data: { role: 'OWNER' },
            select: { id: true, role: true },
        });
    }

    if (!subscription && user.role === 'OWNER') {
        return prisma.user.update({
            where: { id: userId },
            data: { role: 'END_USER' },
            select: { id: true, role: true },
        });
    }

    return user;
}

/** Bulk sync roles for admin lists (no-plan → USER, active plan → OWNER). */
async function reconcileAllNonAdminRoles() {
    await prisma.user.updateMany({
        where: {
            role: 'OWNER',
            NOT: {
                subscriptions: {
                    some: {
                        status: 'ACTIVE',
                    },
                },
            },
        },
        data: { role: 'END_USER' },
    });

    await prisma.user.updateMany({
        where: {
            role: 'END_USER',
            subscriptions: {
                some: {
                    status: 'ACTIVE',
                },
            },
        },
        data: { role: 'OWNER' },
    });
}

module.exports = {
    getActiveSubscription,
    countOwnerProperties,
    assertCanCreateListing,
    getSubscriptionSummary,
    reconcileUserRole,
    reconcileAllNonAdminRoles,
};
