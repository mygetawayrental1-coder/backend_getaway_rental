const { Prisma } = require('@prisma/client');
const prisma = require('../config/database');
const { stringifyJsonField, parseJsonField, getPagination, formatPaginatedResponse } = require('../utils/helpers');
const { validateCouponForPlan, applyCoupon } = require('./coupon.controller');

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

        // Parse features JSON
        const formattedPlans = plans.map(plan => ({
            ...plan,
            features: parseJsonField(plan.features),
        }));

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
            data: {
                ...plan,
                features: parseJsonField(plan.features),
            },
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
        const { name, price, specialPrice, duration, features, status } = req.body;

        const plan = await prisma.subscriptionPlan.create({
            data: {
                name,
                price: parseFloat(price),
                specialPrice: specialPrice ? parseFloat(specialPrice) : null,
                duration,
                features: stringifyJsonField(features),
                status: status || 'Active',
            },
        });

        res.status(201).json({
            success: true,
            message: 'Plan created successfully.',
            data: {
                ...plan,
                features: parseJsonField(plan.features),
            },
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
        const { name, price, specialPrice, duration, features, status } = req.body;

        const existing = await prisma.subscriptionPlan.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({
                success: false,
                message: 'Plan not found.',
            });
        }

        const updateData = {};
        if (name) updateData.name = name;
        if (price !== undefined) updateData.price = parseFloat(price);
        if (specialPrice !== undefined) updateData.specialPrice = specialPrice ? parseFloat(specialPrice) : null;
        if (duration) updateData.duration = duration;
        if (features !== undefined) updateData.features = stringifyJsonField(features);
        if (status) updateData.status = status;

        const plan = await prisma.subscriptionPlan.update({
            where: { id },
            data: updateData,
        });

        res.json({
            success: true,
            message: 'Plan updated successfully.',
            data: {
                ...plan,
                features: parseJsonField(plan.features),
            },
        });
    } catch (error) {
        console.error('Update plan error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update plan.',
        });
    }
};

// Delete plan (Admin only)
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

        await prisma.subscriptionPlan.delete({ where: { id } });

        res.json({
            success: true,
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
        const endDate = new Date();
        if (plan.duration === 'Monthly') {
            endDate.setMonth(endDate.getMonth() + 1);
        } else if (plan.duration === 'Yearly') {
            endDate.setFullYear(endDate.getFullYear() + 1);
        }

        // Payment gateway not wired yet — activate immediately so owners can list properties.
        const activateNow = process.env.SUBSCRIPTION_REQUIRE_PAYMENT !== 'true';
        const subscriptionStatus = activateNow ? 'ACTIVE' : 'PENDING';

        const subscription = await prisma.$transaction(async (tx) => {
            const existingSubscription = await tx.userSubscription.findFirst({
                where: {
                    userId,
                    status: { in: ['ACTIVE', 'PENDING'] },
                    endDate: { gt: new Date() },
                },
            });

            if (existingSubscription) {
                return { conflict: true, existingSubscription };
            }

            if (resolvedCouponId) {
                await applyCoupon(resolvedCouponId, tx);
            }

            return tx.userSubscription.create({
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

// Cancel subscription
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
};
