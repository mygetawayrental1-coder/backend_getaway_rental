const prisma = require('../config/database');
const { normalizeSocialMediaUrls } = require('../utils/listingLinks');

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

function countIcalEntries(icalUrls) {
    if (icalUrls == null || icalUrls === '') return 0;
    let obj = icalUrls;
    if (typeof icalUrls === 'string') {
        try {
            obj = JSON.parse(icalUrls);
        } catch {
            return 0;
        }
    }
    if (!obj || typeof obj !== 'object') return 0;
    return Object.values(obj).filter((v) => v != null && String(v).trim() !== '').length;
}

function planEntitlements(plan) {
    if (!plan) {
        return {
            maxProperties: 0,
            maxPhotos: null,
            maxCalendarSyncs: null,
            bookingManagement: true,
            supportType: 'NONE',
            personalWebsiteLink: false,
            socialMediaLinks: false,
            cityClassifiedListing: false,
            virtualTourLink: false,
            homepageFeaturedListing: false,
            priceUnit: 'FLAT',
        };
    }
    return {
        maxProperties: plan.maxProperties ?? 1,
        maxPhotos: plan.maxPhotos ?? null,
        maxCalendarSyncs: plan.maxCalendarSyncs ?? null,
        bookingManagement: plan.bookingManagement !== false,
        supportType: plan.supportType || 'EMAIL',
        personalWebsiteLink: Boolean(plan.personalWebsiteLink),
        socialMediaLinks: Boolean(plan.socialMediaLinks),
        cityClassifiedListing: Boolean(plan.cityClassifiedListing),
        virtualTourLink: Boolean(plan.virtualTourLink),
        homepageFeaturedListing: Boolean(plan.homepageFeaturedListing),
        priceUnit: plan.priceUnit || 'FLAT',
    };
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

/** Plans without structured entitlements yet — don't block new marketing fields. */
function isLegacyPlan(plan) {
    if (!plan) return true;
    return (
        plan.maxPhotos == null &&
        plan.maxCalendarSyncs == null &&
        !plan.personalWebsiteLink &&
        !plan.socialMediaLinks &&
        !plan.virtualTourLink &&
        !plan.cityClassifiedListing &&
        !plan.homepageFeaturedListing
    );
}

/**
 * Enforce plan entitlements on listing payload (photos, iCal, marketing links, featured).
 */
async function assertListingPayload(userId, payload = {}) {
    const subscription = await getActiveSubscription(userId);
    if (!subscription) {
        return {
            allowed: false,
            status: 403,
            message:
                'An active subscription is required to list properties. Choose a plan on the pricing page.',
        };
    }

    if (isLegacyPlan(subscription.plan)) {
        const legacyEnt = planEntitlements(subscription.plan);
        if (
            (payload.isFeatured === true ||
                payload.isFeatured === 'true' ||
                payload.isFeatured === 1) &&
            !legacyEnt.homepageFeaturedListing
        ) {
            return {
                allowed: false,
                status: 403,
                message: 'Homepage featured listing is not included in your plan.',
            };
        }
        return {
            allowed: true,
            subscription,
            entitlements: legacyEnt,
            legacy: true,
        };
    }

    const ent = planEntitlements(subscription.plan);
    const planName = subscription.plan.name;

    if (payload.photoCount != null && ent.maxPhotos != null) {
        if (payload.photoCount > ent.maxPhotos) {
            return {
                allowed: false,
                status: 403,
                message: `Your ${planName} plan allows up to ${ent.maxPhotos} photos.`,
            };
        }
    }

    if (payload.icalUrls !== undefined && ent.maxCalendarSyncs != null) {
        const n = countIcalEntries(payload.icalUrls);
        if (n > ent.maxCalendarSyncs) {
            return {
                allowed: false,
                status: 403,
                message: `Your ${planName} plan allows up to ${ent.maxCalendarSyncs} calendar sync link(s).`,
            };
        }
    }

    const hasPersonal =
        payload.personalWebsiteUrl != null &&
        String(payload.personalWebsiteUrl).trim() !== '';
    if (hasPersonal && !ent.personalWebsiteLink) {
        return {
            allowed: false,
            status: 403,
            message: `Personal website link is not included in your ${planName} plan. Upgrade to use it.`,
        };
    }

    if (payload.socialMediaUrls !== undefined) {
        const social =
            typeof payload.socialMediaUrls === 'string'
                ? normalizeSocialMediaUrls(payload.socialMediaUrls)
                : normalizeSocialMediaUrls(payload.socialMediaUrls);
        if (social && Object.keys(social).length > 0 && !ent.socialMediaLinks) {
            return {
                allowed: false,
                status: 403,
                message: `Social media links are not included in your ${planName} plan. Upgrade to use them.`,
            };
        }
    }

    const hasTour =
        payload.virtualTourUrl != null && String(payload.virtualTourUrl).trim() !== '';
    if (hasTour && !ent.virtualTourLink) {
        return {
            allowed: false,
            status: 403,
            message: `Virtual tour is not included in your ${planName} plan. Upgrade to use it.`,
        };
    }

    if (
        (payload.cityClassified === true ||
            payload.cityClassified === 'true' ||
            payload.cityClassified === 1) &&
        !ent.cityClassifiedListing
    ) {
        return {
            allowed: false,
            status: 403,
            message: `City classified listing is not included in your ${planName} plan.`,
        };
    }

    if (
        (payload.isFeatured === true ||
            payload.isFeatured === 'true' ||
            payload.isFeatured === 1) &&
        !ent.homepageFeaturedListing
    ) {
        return {
            allowed: false,
            status: 403,
            message: `Homepage featured listing is not included in your ${planName} plan.`,
        };
    }

    return { allowed: true, subscription, entitlements: ent };
}

async function getSubscriptionSummary(userId) {
    const subscription = await getActiveSubscription(userId);
    const listingCount = await countOwnerProperties(userId);
    const maxProperties = subscription?.plan?.maxProperties ?? 0;
    const entitlements = planEntitlements(subscription?.plan);

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
                  entitlements,
              }
            : null,
        entitlements,
        listingCount,
        canListProperties: Boolean(subscription && listingCount < maxProperties),
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
    assertListingPayload,
    getSubscriptionSummary,
    reconcileUserRole,
    reconcileAllNonAdminRoles,
    planEntitlements,
    countIcalEntries,
};
