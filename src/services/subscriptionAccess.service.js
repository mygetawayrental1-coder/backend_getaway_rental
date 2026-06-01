const prisma = require('../config/database');

/** Active paid subscription for listing properties. */
async function getActiveSubscription(userId) {
    if (!userId) return null;

    return prisma.userSubscription.findFirst({
        where: {
            userId,
            status: 'ACTIVE',
            endDate: { gt: new Date() },
        },
        include: {
            plan: true,
        },
        orderBy: { endDate: 'desc' },
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

module.exports = {
    getActiveSubscription,
    countOwnerProperties,
    assertCanCreateListing,
    getSubscriptionSummary,
};
