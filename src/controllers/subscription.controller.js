const { Prisma } = require('@prisma/client');
const prisma = require('../config/database');
const { stringifyJsonField, parseJsonField, getPagination, formatPaginatedResponse } = require('../utils/helpers');
const { validateCouponForPlan, applyCoupon } = require('./coupon.controller');
const { reconcileUserRole } = require('../services/subscriptionAccess.service');
const { serializePlanForApi } = require('../utils/listingLinks');

function parseOptionalIntOrNull(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '' || value === 'unlimited') return null;
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? null : Math.max(0, n);
}

function entitlementFieldsFromBody(body) {
    const data = {};
    if (body.priceUnit !== undefined) {
        data.priceUnit = body.priceUnit === 'PER_LISTING' ? 'PER_LISTING' : 'FLAT';
    }
    if (body.maxPhotos !== undefined) data.maxPhotos = parseOptionalIntOrNull(body.maxPhotos);
    if (body.maxCalendarSyncs !== undefined) {
        data.maxCalendarSyncs = parseOptionalIntOrNull(body.maxCalendarSyncs);
    }
    if (body.maxDescriptionLength !== undefined) {
        data.maxDescriptionLength = parseOptionalIntOrNull(body.maxDescriptionLength);
    }
    if (body.bookingManagement !== undefined) {
        data.bookingManagement = body.bookingManagement === true || body.bookingManagement === 'true';
    }
    if (body.supportType !== undefined) {
        const s = String(body.supportType || 'EMAIL').toUpperCase();
        data.supportType = ['EMAIL', 'TICKET', 'NONE'].includes(s) ? s : 'EMAIL';
    }
    for (const key of [
        'personalWebsiteLink',
        'socialMediaLinks',
        'cityClassifiedListing',
        'virtualTourLink',
        'homepageFeaturedListing',
        'unlimitedTextDescription',
        'unlimitedDescription',
    ]) {
        if (body[key] !== undefined) {
            data[key] = body[key] === true || body[key] === 'true' || body[key] === 1;
        }
    }
    return data;
}

// Get all subscription plans
const getAllPlans = async (req, res) => {
    try {
        const { status } = req.query;

        const where = {};
        if (status) where.status = status;

        const plans = await prisma.subscriptionPlan.findMany({
            where,
            orderBy: { price: 'asc' },
        });

        const formattedPlans = plans.map((plan) => serializePlanForApi(plan, parseJsonField));

        res.json({
            success: true,
            data: formattedPlans,
        });
    } catch (error) {
        console.error('Get all plans error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch plans.',
        });
    }
};

// Get plan by ID
const getPlanById = async (req, res) => {
    try {
        const { id } = req.params;

        const plan = await prisma.subscriptionPlan.findUnique({
            where: { id },
        });

        if (!plan) {
            return res.status(404).json({
                success: false,
                message: 'Plan not found.',
            });
        }

        res.json({
            success: true,
            data: serializePlanForApi(plan, parseJsonField),
        });
    } catch (error) {
        console.error('Get plan by ID error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch plan.',
        });
    }
};

// Create plan (Admin only)
const createPlan = async (req, res) => {
    try {
        const { name, price, specialPrice, duration, features, status, maxProperties } = req.body;

        const plan = await prisma.subscriptionPlan.create({
            data: {
                name,
                price: parseFloat(price),
                specialPrice: specialPrice ? parseFloat(specialPrice) : null,
                duration,
                features: stringifyJsonField(features),
                status: status || 'Active',
                maxProperties: maxProperties != null ? Math.max(1, parseInt(maxProperties, 10) || 1) : 1,
                ...entitlementFieldsFromBody(req.body),
            },
        });

        res.status(201).json({
            success: true,
            message: 'Plan created successfully.',
            data: serializePlanForApi(plan, parseJsonField),
        });
    } catch (error) {
        console.error('Create plan error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create plan.',
        });
    }
};

// Update plan (Admin only)
const updatePlan = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, price, specialPrice, duration, features, status, maxProperties } = req.body;

        const existing = await prisma.subscriptionPlan.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({
                success: false,
                message: 'Plan not found.',
            });
        }

        const updateData = {
            ...entitlementFieldsFromBody(req.body),
        };
        if (name) updateData.name = name;
        if (price !== undefined) updateData.price = parseFloat(price);
        if (specialPrice !== undefined) updateData.specialPrice = specialPrice ? parseFloat(specialPrice) : null;
        if (duration) updateData.duration = duration;
        if (features !== undefined) updateData.features = stringifyJsonField(features);
        if (status) updateData.status = status;
        if (maxProperties !== undefined) {
            updateData.maxProperties = Math.max(1, parseInt(maxProperties, 10) || 1);
        }

        const plan = await prisma.subscriptionPlan.update({
            where: { id },
            data: updateData,
        });

        res.json({
            success: true,
            message: 'Plan updated successfully.',
            data: serializePlanForApi(plan, parseJsonField),
        });
    } catch (error) {
        console.error('Update plan error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update plan.',
        });
    }
};

// Delete plan (Admin only).
// Plans referenced by UserSubscription cannot be hard-deleted (FK RESTRICT) —
// deactivate them instead so pricing hides them without breaking owner history.
const deletePlan = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await prisma.subscriptionPlan.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({
                success: false,
                message: 'Plan not found.',
            });
        }

        const [subCount, couponCount] = await Promise.all([
            prisma.userSubscription.count({ where: { planId: id } }),
            prisma.coupon.count({ where: { planId: id } }),
        ]);

        if (subCount > 0 || couponCount > 0) {
            const plan = await prisma.subscriptionPlan.update({
                where: { id },
                data: { status: 'Inactive' },
            });
            return res.json({
                success: true,
                softDeleted: true,
                message:
                    subCount > 0
                        ? `This plan has ${subCount} subscription(s), so it was deactivated instead of deleted. Owners keep their history; it no longer appears on pricing.`
                        : 'This plan is linked to coupons, so it was deactivated instead of deleted.',
                data: plan,
            });
        }

        await prisma.subscriptionPlan.delete({ where: { id } });

        res.json({
            success: true,
            softDeleted: false,
            message: 'Plan deleted successfully.',
        });
    } catch (error) {
        console.error('Delete plan error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete plan.',
        });
    }
};

// Subscribe to a plan
const subscribe = async (req, res) => {
    try {
        const { planId, couponId, code, couponCode } = req.body;
        const userId = req.user.id;

        const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
        if (!plan) {
            return res.status(404).json({
                success: false,
                message: 'Plan not found.',
            });
        }

        let resolvedCouponId = couponId || null;
        const couponInput = code || couponCode;

        if (resolvedCouponId || couponInput) {
            const validation = await validateCouponForPlan({
                couponId: resolvedCouponId || undefined,
                code: couponInput || undefined,
                planId,
            });
            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    message: validation.message || 'Invalid coupon.',
                });
            }
            resolvedCouponId = validation.coupon.id;
        }

        const startDate = new Date();
        // Plans do not expire — keep a far-future endDate for DB schema only.
        const endDate = new Date('9999-12-31T00:00:00.000Z');

        // Payment gateway not wired yet — activate immediately so owners can list properties.
        const activateNow = process.env.SUBSCRIPTION_REQUIRE_PAYMENT !== 'true';
        const subscriptionStatus = activateNow ? 'ACTIVE' : 'PENDING';

        const subscription = await prisma.$transaction(async (tx) => {
            const existingSubscription = await tx.userSubscription.findFirst({
                where: {
                    userId,
                    status: { in: ['ACTIVE', 'PENDING'] },
                },
            });

            if (existingSubscription) {
                return { conflict: true, existingSubscription };
            }

            if (resolvedCouponId) {
                await applyCoupon(resolvedCouponId, tx);
            }

            const newSub = await tx.userSubscription.create({
                data: {
                    userId,
                    planId,
                    couponId: resolvedCouponId,
                    startDate,
                    endDate,
                    status: subscriptionStatus,
                },
                include: {
                    plan: true,
                    coupon: true,
                },
            });

            if (subscriptionStatus === 'ACTIVE') {
                const user = await tx.user.findUnique({ where: { id: userId } });
                if (user && user.role !== 'ADMIN' && user.role !== 'OWNER') {
                    await tx.user.update({
                        where: { id: userId },
                        data: { role: 'OWNER' }
                    });
                }
            }

            return newSub;
        }, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 5000,
            timeout: 10000,
        });

        if (subscription && subscription.conflict === true) {
            return res.status(400).json({
                success: false,
                message: 'You already have an active subscription.',
                data: subscription.existingSubscription,
            });
        }

        res.status(201).json({
            success: true,
            message: activateNow
                ? 'Subscription activated. You can add listings from your dashboard.'
                : 'Subscription created. Please complete payment.',
            data: subscription,
        });
    } catch (error) {
        if (error.code === 'P2034') {
            return res.status(409).json({
                success: false,
                message: 'Subscription request conflicted. Please try again.',
            });
        }
        if (error.message && /coupon/i.test(error.message)) {
            return res.status(400).json({
                success: false,
                message: error.message,
            });
        }
        console.error('Subscribe error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to subscribe.',
        });
    }
};

// Get current user's subscription
const getMySubscription = async (req, res) => {
    try {
        const userId = req.user.id;

        const subscription = await prisma.userSubscription.findFirst({
            where: {
                userId,
                status: { in: ['ACTIVE', 'PENDING', 'COMPLETED'] },
            },
            orderBy: { createdAt: 'desc' },
            include: {
                plan: true,
                payment: true,
            },
        });

        res.json({
            success: true,
            data: subscription,
        });
    } catch (error) {
        console.error('Get my subscription error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch subscription.',
        });
    }
};

// Admin manually assign or update subscription
const adminAssignSubscription = async (req, res) => {
    try {
        const { userId } = req.params;
        const { planId, isCustom, customName, customMaxProperties, customDurationMonths } = req.body;

        let finalPlanId = planId;
        // Plans do not expire — keep a far-future endDate for DB schema only.
        const endDate = new Date('9999-12-31T00:00:00.000Z');

        // 1. If custom, create a new SubscriptionPlan on the fly
        if (isCustom) {
            const newPlan = await prisma.subscriptionPlan.create({
                data: {
                    name: customName || `Custom Plan - ${userId}`,
                    price: 0,
                    duration: 'Custom',
                    maxProperties: parseInt(customMaxProperties, 10) || 1,
                    features: JSON.stringify(["Custom manual limits"]),
                    status: 'Active'
                }
            });
            finalPlanId = newPlan.id;
        } else {
            // 2. Predefined plan
            if (!planId) {
                return res.status(400).json({ success: false, message: 'planId is required for predefined plans' });
            }
            const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
            if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });
        }

        // Cancel existing active subscriptions
        await prisma.userSubscription.updateMany({
            where: { userId, status: 'ACTIVE' },
            data: { status: 'CANCELLED' }
        });

        // Create new subscription
        const sub = await prisma.userSubscription.create({
            data: {
                userId,
                planId: finalPlanId,
                status: 'ACTIVE',
                startDate: new Date(),
                endDate,
                autoRenew: false
            },
            include: { plan: true }
        });

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (user && user.role !== 'ADMIN' && user.role !== 'OWNER') {
            await prisma.user.update({
                where: { id: userId },
                data: { role: 'OWNER' },
            });
        }

        res.json({
            success: true,
            message: 'Subscription assigned successfully.',
            data: sub
        });
    } catch (error) {
        console.error('Admin assign subscription error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to assign subscription.',
        });
    }
};

// Cancel subscription (Owner or Admin)
const cancelSubscription = async (req, res) => {
    try {
        const userId = req.user.id;

        const subscription = await prisma.userSubscription.findFirst({
            where: {
                userId,
                status: { in: ['ACTIVE', 'PENDING'] },
            },
        });

        if (!subscription) {
            return res.status(404).json({
                success: false,
                message: 'No active subscription found.',
            });
        }

        await prisma.userSubscription.update({
            where: { id: subscription.id },
            data: { status: 'CANCELLED' },
        });

        // Demote to USER immediately when no active plan remains.
        try {
            await reconcileUserRole(userId);
        } catch (reconcileErr) {
            console.warn('[subscriptions] role reconcile after cancel failed:', reconcileErr.message);
        }

        res.json({
            success: true,
            message: 'Subscription cancelled.',
        });
    } catch (error) {
        console.error('Cancel subscription error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to cancel subscription.',
        });
    }
};

module.exports = {
    getAllPlans,
    getPlanById,
    createPlan,
    updatePlan,
    deletePlan,
    subscribe,
    getMySubscription,
    cancelSubscription,
    adminAssignSubscription,
};
