const prisma = require('../config/database');

// Get dashboard statistics (Admin and Owner)
const getStats = async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;

        const isOwner = role === 'OWNER';

        // Base where clauses for owner vs admin
        const propertyWhere = isOwner ? { ownerId: userId } : {};
        const inquiryWhere = isOwner ? { property: { ownerId: userId } } : {};
        // Owners don't manage subscriptions or users generally, but we can show them their own subscription info

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
            totalRequests,
        ] = await Promise.all([
            isOwner ? 0 : prisma.user.count(),
            isOwner ? 0 : prisma.user.count({ where: { role: 'OWNER' } }),
            isOwner ? 0 : prisma.user.count({ where: { role: 'END_USER' } }),
            prisma.property.count({ where: propertyWhere }),
            prisma.property.count({ where: { ...propertyWhere, status: 'Active' } }),
            prisma.inquiry.count({ where: inquiryWhere }),
            prisma.inquiry.count({ where: { ...inquiryWhere, status: 'PENDING' } }),
            isOwner ? prisma.userSubscription.count({ where: { userId } }) : prisma.userSubscription.count(),
            isOwner ? prisma.userSubscription.count({ where: { userId, status: 'ACTIVE' } }) : prisma.userSubscription.count({ where: { status: 'ACTIVE' } }),
            isOwner ? prisma.payment.count({ where: { userId, status: 'paid' } }) : prisma.payment.count({ where: { status: 'paid' } }),
            prisma.subscriptionPlan.count(),
            prisma.ownerRequest.count({ where: { status: 'PENDING' } }),
        ]);

        // Calculate revenue
        const revenue = await prisma.payment.aggregate({
            where: isOwner ? { userId, status: 'paid' } : { status: 'paid' },
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
                ownerRequests: {
                    pending: totalRequests,
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
