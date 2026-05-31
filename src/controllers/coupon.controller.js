const prisma = require('../config/database');

const DISCOUNT_TYPES = ['PERCENT', 'FIXED'];

function normalizeCode(code) {
    return code ? String(code).trim().toUpperCase() : '';
}

function roundPrice(n) {
    return Math.round(n * 100) / 100;
}

function computeDiscountedPrice(basePrice, coupon) {
    const base = parseFloat(basePrice) || 0;
    if (coupon.discountType === 'PERCENT') {
        const pct = Math.min(100, Math.max(0, coupon.discountValue));
        return roundPrice(base * (1 - pct / 100));
    }
    if (coupon.discountType === 'FIXED') {
        return roundPrice(Math.max(0, base - coupon.discountValue));
    }
    return base;
}

/**
 * Shared validation used by HTTP handler and subscription checkout.
 * @returns {Promise<{ valid: boolean, message?: string, coupon?: object, basePrice?: number, discountedPrice?: number }>}
 */
async function validateCouponForPlan({ code, couponId, planId }) {
    let coupon = null;

    if (couponId) {
        coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
    } else if (code) {
        const normalized = normalizeCode(code);
        coupon = await prisma.coupon.findFirst({
            where: { code: { equals: normalized, mode: 'insensitive' } },
        });
    } else {
        return { valid: false, message: 'Coupon code is required.' };
    }

    if (!coupon) {
        return { valid: false, message: 'Invalid coupon code.' };
    }

    if (!coupon.isActive) {
        return { valid: false, message: 'This coupon is no longer active.' };
    }

    if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
        return { valid: false, message: 'This coupon has expired.' };
    }

    if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
        return { valid: false, message: 'This coupon has reached its usage limit.' };
    }

    if (coupon.planId && planId && coupon.planId !== planId) {
        return { valid: false, message: 'This coupon does not apply to the selected plan.' };
    }

    if (coupon.planId && !planId) {
        return { valid: false, message: 'planId is required for this coupon.' };
    }

    let basePrice = null;
    let discountedPrice = null;

    if (planId) {
        const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
        if (!plan) {
            return { valid: false, message: 'Plan not found.' };
        }
        if (coupon.planId && coupon.planId !== plan.id) {
            return { valid: false, message: 'This coupon does not apply to the selected plan.' };
        }
        basePrice = plan.specialPrice != null ? plan.specialPrice : plan.price;
        discountedPrice = computeDiscountedPrice(basePrice, coupon);
    }

    return {
        valid: true,
        coupon: {
            id: coupon.id,
            code: coupon.code,
            discountType: coupon.discountType,
            discountValue: coupon.discountValue,
            planId: coupon.planId,
        },
        basePrice,
        discountedPrice,
    };
}

/**
 * Increment coupon usage when a subscription is confirmed/created.
 * @param {string} couponId
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
async function applyCoupon(couponId, tx = prisma) {
    if (!couponId) return null;

    const coupon = await tx.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) {
        throw new Error('Coupon not found.');
    }
    if (!coupon.isActive) {
        throw new Error('Coupon is not active.');
    }
    if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
        throw new Error('Coupon has expired.');
    }
    if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
        throw new Error('Coupon usage limit reached.');
    }

    return tx.coupon.update({
        where: { id: couponId },
        data: { usedCount: { increment: 1 } },
    });
}

/**
 * POST /subscriptions/validate-coupon
 */
const validateCoupon = async (req, res) => {
    try {
        const { code, planId, couponId } = req.body;

        const result = await validateCouponForPlan({
            code: code || undefined,
            couponId: couponId || undefined,
            planId: planId || undefined,
        });

        if (!result.valid) {
            return res.json({
                success: true,
                valid: false,
                message: result.message || 'Invalid coupon.',
            });
        }

        res.json({
            success: true,
            valid: true,
            coupon: result.coupon,
            basePrice: result.basePrice,
            discountedPrice: result.discountedPrice,
        });
    } catch (error) {
        console.error('Validate coupon error:', error);
        res.status(500).json({
            success: false,
            valid: false,
            message: 'Coupon validation failed.',
        });
    }
};

/**
 * POST /coupons
 */
const createCoupon = async (req, res) => {
    try {
        const { code, discountType, discountValue, maxUses, expiresAt, planId } = req.body;

        const normalizedCode = normalizeCode(code);
        if (!normalizedCode) {
            return res.status(400).json({ success: false, message: 'code is required.' });
        }

        const type = discountType ? String(discountType).toUpperCase() : '';
        if (!DISCOUNT_TYPES.includes(type)) {
            return res.status(400).json({
                success: false,
                message: 'discountType must be PERCENT or FIXED.',
            });
        }

        const value = parseFloat(discountValue);
        if (!value || value <= 0) {
            return res.status(400).json({
                success: false,
                message: 'discountValue must be greater than zero.',
            });
        }
        if (type === 'PERCENT' && value > 100) {
            return res.status(400).json({
                success: false,
                message: 'Percent discount cannot exceed 100.',
            });
        }

        if (planId) {
            const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
            if (!plan) {
                return res.status(400).json({ success: false, message: 'Invalid planId.' });
            }
        }

        const coupon = await prisma.coupon.create({
            data: {
                code: normalizedCode,
                discountType: type,
                discountValue: value,
                maxUses: maxUses != null ? parseInt(maxUses, 10) : null,
                expiresAt: expiresAt ? new Date(expiresAt) : null,
                planId: planId || null,
                isActive: true,
            },
            include: {
                plan: { select: { id: true, name: true } },
            },
        });

        res.status(201).json({ success: true, data: coupon });
    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: 'Coupon code already exists.' });
        }
        console.error('Create coupon error:', error);
        res.status(500).json({ success: false, message: 'Failed to create coupon.' });
    }
};

/**
 * GET /coupons
 */
const listCoupons = async (req, res) => {
    try {
        const coupons = await prisma.coupon.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
                plan: { select: { id: true, name: true } },
                _count: { select: { subscriptions: true } },
            },
        });

        res.json({ success: true, data: coupons });
    } catch (error) {
        console.error('List coupons error:', error);
        res.status(500).json({ success: false, message: 'Failed to list coupons.' });
    }
};

/**
 * PATCH /coupons/:id/toggle
 */
const toggleCoupon = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await prisma.coupon.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Coupon not found.' });
        }

        const coupon = await prisma.coupon.update({
            where: { id },
            data: { isActive: !existing.isActive },
            include: { plan: { select: { id: true, name: true } } },
        });

        res.json({ success: true, data: coupon });
    } catch (error) {
        console.error('Toggle coupon error:', error);
        res.status(500).json({ success: false, message: 'Failed to toggle coupon.' });
    }
};

/**
 * DELETE /coupons/:id
 */
const deleteCoupon = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await prisma.coupon.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Coupon not found.' });
        }

        if (existing.usedCount > 0) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete a coupon that has already been used.',
            });
        }

        await prisma.coupon.delete({ where: { id } });

        res.json({ success: true, message: 'Coupon deleted.' });
    } catch (error) {
        console.error('Delete coupon error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete coupon.' });
    }
};

module.exports = {
    validateCoupon,
    validateCouponForPlan,
    applyCoupon,
    createCoupon,
    listCoupons,
    toggleCoupon,
    deleteCoupon,
};
