const prisma = require('../config/database');

// Get dashboard statistics (Admin only)
const getStats = async (req, res) => {
    try {
        const [
            totalUsers,
            totalOwners,
            totalEndUsers,
            totalProperties,
            activeProperties,
            totalInquiries,
            pendingInquiries,
            totalSubscriptions,
            activeSubscriptions,
            totalPayments,
            totalPlans,
        ] = await Promise.all([
            prisma.user.count(),
            prisma.user.count({ where: { role: 'OWNER' } }),
            prisma.user.count({ where: { role: 'END_USER' } }),
            prisma.property.count(),
            prisma.property.count({ where: { status: 'Active' } }),
            prisma.inquiry.count(),
            prisma.inquiry.count({ where: { status: 'PENDING' } }),
            prisma.userSubscription.count(),
            prisma.userSubscription.count({ where: { status: 'ACTIVE' } }),
            prisma.payment.count({ where: { status: 'paid' } }),
            prisma.subscriptionPlan.count(),
        ]);

        // Calculate revenue
        const revenue = await prisma.payment.aggregate({
            where: { status: 'paid' },
            _sum: { amount: true },
        });

        res.json({
            success: true,
            data: {
                users: {
                    total: totalUsers,
                    owners: totalOwners,
                    endUsers: totalEndUsers,
                },
                properties: {
                    total: totalProperties,
                    active: activeProperties,
                },
                inquiries: {
                    total: totalInquiries,
                    pending: pendingInquiries,
                },
                subscriptions: {
                    total: totalSubscriptions,
                    active: activeSubscriptions,
                    plansCount: totalPlans,
                },
                payments: {
                    total: totalPayments,
                    revenue: revenue._sum.amount || 0,
                },
            },
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch statistics.',
        });
    }
};

module.exports = {
    getStats,
};
