const prisma = require('../config/database');
const { getPagination, formatPaginatedResponse } = require('../utils/helpers');
const { createTypedNotification, NOTIFICATION_TYPES } = require('../services/notification.service');

function currentPeriod() {
    const d = new Date();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${month}`;
}

function monthRange(year, monthIndex) {
    const start = new Date(year, monthIndex, 1);
    const end = new Date(year, monthIndex + 1, 1);
    return { start, end };
}

function roundMoney(n) {
    return Math.round((n || 0) * 100) / 100;
}

async function computeEarningsSummary(ownerId) {
    const completedBase = {
        status: 'COMPLETED',
        property: { ownerId },
    };

    const now = new Date();
    const thisMonth = monthRange(now.getFullYear(), now.getMonth());
    const lastMonth = monthRange(now.getFullYear(), now.getMonth() - 1);

    const [
        totalAgg,
        thisMonthAgg,
        lastMonthAgg,
        pendingAgg,
        paidAgg,
    ] = await Promise.all([
        prisma.booking.aggregate({
            where: completedBase,
            _sum: { totalAmount: true },
        }),
        prisma.booking.aggregate({
            where: {
                ...completedBase,
                completedAt: { gte: thisMonth.start, lt: thisMonth.end },
            },
            _sum: { totalAmount: true },
        }),
        prisma.booking.aggregate({
            where: {
                ...completedBase,
                completedAt: { gte: lastMonth.start, lt: lastMonth.end },
            },
            _sum: { totalAmount: true },
        }),
        prisma.payout.aggregate({
            where: {
                ownerId,
                status: { in: ['PENDING', 'PROCESSING'] },
            },
            _sum: { amount: true },
        }),
        prisma.payout.aggregate({
            where: { ownerId, status: 'PAID' },
            _sum: { amount: true },
        }),
    ]);

    const totalEarnings = roundMoney(totalAgg._sum.totalAmount);
    const thisMonthEarnings = roundMoney(thisMonthAgg._sum.totalAmount);
    const lastMonthEarnings = roundMoney(lastMonthAgg._sum.totalAmount);
    const pendingPayouts = roundMoney(pendingAgg._sum.amount);
    const paidOut = roundMoney(paidAgg._sum.amount);
    const availableForPayout = roundMoney(totalEarnings - pendingPayouts - paidOut);

    return {
        totalEarnings,
        thisMonthEarnings,
        lastMonthEarnings,
        pendingPayouts,
        paidOut,
        availableForPayout: Math.max(0, availableForPayout),
        period: currentPeriod(),
    };
}

/**
 * GET /payouts/earnings
 */
const getEarningsSummary = async (req, res) => {
    try {
        const summary = await computeEarningsSummary(req.user.id);
        res.json({ success: true, data: summary });
    } catch (error) {
        console.error('Get earnings summary error:', error);
        res.status(500).json({ success: false, message: 'Failed to load earnings summary.' });
    }
};

/**
 * GET /payouts/history
 */
const getPayoutHistory = async (req, res) => {
    try {
        const { status, page, limit } = req.query;
        const pagination = getPagination(page, limit);

        const where = { ownerId: req.user.id };
        if (status) where.status = String(status).toUpperCase();

        const [rows, total] = await Promise.all([
            prisma.payout.findMany({
                where,
                skip: pagination.skip,
                take: pagination.take,
                orderBy: { requestedAt: 'desc' },
            }),
            prisma.payout.count({ where }),
        ]);

        res.json({
            success: true,
            ...formatPaginatedResponse(rows, total, pagination.page, pagination.limit),
        });
    } catch (error) {
        console.error('Get payout history error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch payout history.' });
    }
};

/**
 * POST /payouts/request
 */
const requestPayout = async (req, res) => {
    try {
        const { amount, currency, method, notes } = req.body;
        const parsedAmount = parseFloat(amount);

        if (!parsedAmount || parsedAmount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'A valid payout amount greater than zero is required.',
            });
        }

        const summary = await computeEarningsSummary(req.user.id);
        if (parsedAmount > summary.availableForPayout) {
            return res.status(400).json({
                success: false,
                message: `Requested amount exceeds available balance ($${summary.availableForPayout}).`,
                data: summary,
            });
        }

        const payout = await prisma.payout.create({
            data: {
                ownerId: req.user.id,
                amount: roundMoney(parsedAmount),
                currency: currency || 'USD',
                method: method || null,
                notes: notes || null,
                status: 'PENDING',
                period: currentPeriod(),
            },
        });

        try {
            const admins = await prisma.user.findMany({
                where: { role: 'ADMIN', isActive: true },
                select: { id: true },
            });
            const ownerName = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || req.user.email;

            await Promise.all(
                admins.map((admin) =>
                    createTypedNotification({
                        userId: admin.id,
                        type: NOTIFICATION_TYPES.PAYOUT_REQUEST_NEW,
                        data: {
                            payoutId: payout.id,
                            ownerId: req.user.id,
                            amount: payout.amount,
                            currency: payout.currency,
                        },
                        vars: { amount: payout.amount, ownerName },
                    }),
                ),
            );
        } catch (notifyErr) {
            console.error('Payout request admin notification error:', notifyErr);
        }

        res.status(201).json({
            success: true,
            message: 'Payout request submitted.',
            data: payout,
        });
    } catch (error) {
        console.error('Request payout error:', error);
        res.status(500).json({ success: false, message: 'Failed to submit payout request.' });
    }
};

/**
 * GET /payouts/admin/all
 */
const getAllPayouts = async (req, res) => {
    try {
        const { status, period, page, limit } = req.query;
        const pagination = getPagination(page, limit);

        const where = {};
        if (status) where.status = String(status).toUpperCase();
        if (period) where.period = String(period);

        const [rows, total] = await Promise.all([
            prisma.payout.findMany({
                where,
                skip: pagination.skip,
                take: pagination.take,
                orderBy: { requestedAt: 'desc' },
                include: {
                    owner: {
                        select: {
                            id: true,
                            email: true,
                            firstName: true,
                            lastName: true,
                            phoneNumber: true,
                        },
                    },
                },
            }),
            prisma.payout.count({ where }),
        ]);

        res.json({
            success: true,
            ...formatPaginatedResponse(rows, total, pagination.page, pagination.limit),
        });
    } catch (error) {
        console.error('Get all payouts error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch payouts.' });
    }
};

/**
 * PATCH /payouts/:id/process
 */
const processPayout = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, reference, notes } = req.body;

        const allowed = ['PROCESSING', 'PAID', 'FAILED'];
        const nextStatus = status ? String(status).toUpperCase() : null;

        if (!nextStatus || !allowed.includes(nextStatus)) {
            return res.status(400).json({
                success: false,
                message: 'status must be one of: PROCESSING, PAID, FAILED.',
            });
        }

        const payout = await prisma.payout.findUnique({
            where: { id },
            include: {
                owner: {
                    select: { id: true, email: true, firstName: true, lastName: true },
                },
            },
        });

        if (!payout) {
            return res.status(404).json({ success: false, message: 'Payout not found.' });
        }

        const now = new Date();
        const updateData = {
            status: nextStatus,
        };

        if (reference !== undefined) updateData.reference = reference || null;
        if (notes !== undefined) updateData.notes = notes || null;

        if (nextStatus === 'PROCESSING' || nextStatus === 'FAILED') {
            updateData.processedAt = now;
        }
        if (nextStatus === 'PAID') {
            updateData.paidAt = now;
            if (!payout.processedAt) updateData.processedAt = now;
        }

        const updated = await prisma.payout.update({
            where: { id: payout.id },
            data: updateData,
            include: {
                owner: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                        phoneNumber: true,
                    },
                },
            },
        });

        if (nextStatus === 'PAID') {
            try {
                await createTypedNotification({
                    userId: updated.ownerId,
                    type: NOTIFICATION_TYPES.PAYOUT_PROCESSED,
                    data: {
                        payoutId: updated.id,
                        amount: updated.amount,
                        currency: updated.currency,
                        reference: updated.reference,
                    },
                    vars: { amount: updated.amount },
                });
            } catch (notifyErr) {
                console.error('Payout processed owner notification error:', notifyErr);
            }
        }

        res.json({
            success: true,
            message: 'Payout updated.',
            data: updated,
        });
    } catch (error) {
        console.error('Process payout error:', error);
        res.status(500).json({ success: false, message: 'Failed to process payout.' });
    }
};

module.exports = {
    getEarningsSummary,
    getPayoutHistory,
    requestPayout,
    getAllPayouts,
    processPayout,
    computeEarningsSummary,
};
