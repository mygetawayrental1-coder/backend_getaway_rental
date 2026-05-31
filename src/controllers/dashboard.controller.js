const prisma = require('../config/database');

const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'ONGOING', 'COMPLETED', 'CANCELLED'];

function roundMoney(n) {
    return Math.round((n || 0) * 100) / 100;
}

function startOfMonth(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfNextMonth(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

function monthRange(year, monthIndex) {
    return {
        start: new Date(year, monthIndex, 1),
        end: new Date(year, monthIndex + 1, 1),
    };
}

async function countBookingsByStatus(where) {
    const rows = await prisma.booking.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
    });
    const counts = Object.fromEntries(BOOKING_STATUSES.map((s) => [s.toLowerCase(), 0]));
    for (const row of rows) {
        counts[row.status.toLowerCase()] = row._count._all;
    }
    counts.total = rows.reduce((sum, row) => sum + row._count._all, 0);
    return counts;
}

async function getAdminStats() {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = startOfNextMonth(now);

    const [
        totalUsers,
        totalOwners,
        totalEndUsers,
        newThisMonth,
        totalProperties,
        activeProperties,
        inactiveProperties,
        pendingProperties,
        featuredProperties,
        bookingCounts,
        bookingRevenue,
        totalInquiries,
        pendingInquiries,
        acceptedInquiries,
        rejectedInquiries,
        totalReviews,
        pendingReviews,
        approvedReviews,
        plansCount,
        activeSubscriptions,
        expiringThisMonth,
        pendingPayouts,
        processingPayouts,
        totalPaidPayouts,
        openTickets,
        inProgressTickets,
        pendingOwnerRequests,
    ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { role: 'OWNER' } }),
        prisma.user.count({ where: { role: 'END_USER' } }),
        prisma.user.count({ where: { createdAt: { gte: monthStart, lt: monthEnd } } }),
        prisma.property.count(),
        prisma.property.count({ where: { status: 'Active' } }),
        prisma.property.count({ where: { status: 'Inactive' } }),
        prisma.property.count({ where: { status: 'Pending' } }),
        prisma.property.count({ where: { isFeatured: true } }),
        countBookingsByStatus({}),
        prisma.booking.aggregate({
            where: { status: 'COMPLETED' },
            _sum: { totalAmount: true },
        }),
        prisma.inquiry.count(),
        prisma.inquiry.count({ where: { status: 'PENDING' } }),
        prisma.inquiry.count({ where: { status: 'ACCEPTED' } }),
        prisma.inquiry.count({ where: { status: 'REJECTED' } }),
        prisma.review.count(),
        prisma.review.count({ where: { isApproved: false } }),
        prisma.review.count({ where: { isApproved: true } }),
        prisma.subscriptionPlan.count(),
        prisma.userSubscription.count({ where: { status: 'ACTIVE' } }),
        prisma.userSubscription.count({
            where: {
                status: 'ACTIVE',
                endDate: { gte: monthStart, lt: monthEnd },
            },
        }),
        prisma.payout.count({ where: { status: 'PENDING' } }),
        prisma.payout.count({ where: { status: 'PROCESSING' } }),
        prisma.payout.aggregate({
            where: { status: 'PAID' },
            _sum: { amount: true },
        }),
        prisma.supportTicket.count({ where: { status: 'OPEN' } }),
        prisma.supportTicket.count({ where: { status: 'IN_PROGRESS' } }),
        prisma.ownerRequest.count({ where: { status: 'PENDING' } }),
    ]);

    return {
        users: {
            total: totalUsers,
            owners: totalOwners,
            endUsers: totalEndUsers,
            newThisMonth,
        },
        properties: {
            total: totalProperties,
            active: activeProperties,
            inactive: inactiveProperties,
            pending: pendingProperties,
            featured: featuredProperties,
        },
        bookings: {
            total: bookingCounts.total,
            pending: bookingCounts.pending,
            confirmed: bookingCounts.confirmed,
            ongoing: bookingCounts.ongoing,
            completed: bookingCounts.completed,
            cancelled: bookingCounts.cancelled,
            revenueTotal: roundMoney(bookingRevenue._sum.totalAmount),
        },
        inquiries: {
            total: totalInquiries,
            pending: pendingInquiries,
            accepted: acceptedInquiries,
            rejected: rejectedInquiries,
        },
        reviews: {
            total: totalReviews,
            pending: pendingReviews,
            approved: approvedReviews,
        },
        subscriptions: {
            plansCount,
            activeSubscriptions,
            expiringThisMonth,
        },
        payouts: {
            pending: pendingPayouts,
            processing: processingPayouts,
            totalPaid: roundMoney(totalPaidPayouts._sum.amount),
        },
        support: {
            open: openTickets,
            inProgress: inProgressTickets,
        },
        ownerRequests: {
            pending: pendingOwnerRequests,
        },
    };
}

async function getOwnerStats(ownerId) {
    const propertyWhere = { ownerId };
    const bookingWhere = { property: propertyWhere };
    const inquiryWhere = { property: propertyWhere };
    const reviewWhere = { property: propertyWhere, isApproved: true };

    const now = new Date();
    const thisMonth = monthRange(now.getFullYear(), now.getMonth());
    const lastMonth = monthRange(now.getFullYear(), now.getMonth() - 1);
    const completedWhere = { ...bookingWhere, status: 'COMPLETED' };

    const [
        totalProperties,
        activeProperties,
        inactiveProperties,
        bookingCounts,
        totalRevenueAgg,
        thisMonthRevenueAgg,
        lastMonthRevenueAgg,
        totalInquiries,
        pendingInquiries,
        acceptedInquiries,
        reviewAgg,
        pendingPayoutAgg,
        totalPaidAgg,
        unreadNotifications,
    ] = await Promise.all([
        prisma.property.count({ where: propertyWhere }),
        prisma.property.count({ where: { ...propertyWhere, status: 'Active' } }),
        prisma.property.count({ where: { ...propertyWhere, status: 'Inactive' } }),
        countBookingsByStatus(bookingWhere),
        prisma.booking.aggregate({
            where: completedWhere,
            _sum: { totalAmount: true },
        }),
        prisma.booking.aggregate({
            where: {
                ...completedWhere,
                completedAt: { gte: thisMonth.start, lt: thisMonth.end },
            },
            _sum: { totalAmount: true },
        }),
        prisma.booking.aggregate({
            where: {
                ...completedWhere,
                completedAt: { gte: lastMonth.start, lt: lastMonth.end },
            },
            _sum: { totalAmount: true },
        }),
        prisma.inquiry.count({ where: inquiryWhere }),
        prisma.inquiry.count({ where: { ...inquiryWhere, status: 'PENDING' } }),
        prisma.inquiry.count({ where: { ...inquiryWhere, status: 'ACCEPTED' } }),
        prisma.review.aggregate({
            where: reviewWhere,
            _count: { id: true },
            _avg: { overallRating: true },
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
        prisma.notification.count({
            where: { userId: ownerId, isRead: false },
        }),
    ]);

    const totalEarnings = roundMoney(totalRevenueAgg._sum.totalAmount);
    const pendingPayouts = roundMoney(pendingPayoutAgg._sum.amount);
    const totalPaid = roundMoney(totalPaidAgg._sum.amount);
    const availableForPayout = Math.max(0, roundMoney(totalEarnings - pendingPayouts - totalPaid));

    return {
        properties: {
            total: totalProperties,
            active: activeProperties,
            inactive: inactiveProperties,
        },
        bookings: {
            total: bookingCounts.total,
            pending: bookingCounts.pending,
            confirmed: bookingCounts.confirmed,
            ongoing: bookingCounts.ongoing,
            completed: bookingCounts.completed,
            cancelled: bookingCounts.cancelled,
            totalRevenue: roundMoney(totalRevenueAgg._sum.totalAmount),
            thisMonthRevenue: roundMoney(thisMonthRevenueAgg._sum.totalAmount),
            lastMonthRevenue: roundMoney(lastMonthRevenueAgg._sum.totalAmount),
        },
        inquiries: {
            total: totalInquiries,
            pending: pendingInquiries,
            accepted: acceptedInquiries,
        },
        reviews: {
            total: reviewAgg._count.id,
            averageRating: reviewAgg._avg.overallRating
                ? roundMoney(reviewAgg._avg.overallRating)
                : 0,
        },
        payouts: {
            pending: pendingPayouts,
            totalPaid,
            availableForPayout,
        },
        notifications: {
            unreadCount: unreadNotifications,
        },
    };
}

async function getEndUserStats(user) {
    const bookingWhere = {
        OR: [{ guestClerkId: user.id }, { guestEmail: user.email }],
    };

    const [bookingCounts, wishlistCount, unreadNotifications] = await Promise.all([
        countBookingsByStatus(bookingWhere),
        prisma.wishlist.count({ where: { userId: user.id } }),
        prisma.notification.count({
            where: { userId: user.id, isRead: false },
        }),
    ]);

    return {
        bookings: {
            total: bookingCounts.total,
            pending: bookingCounts.pending,
            confirmed: bookingCounts.confirmed,
            ongoing: bookingCounts.ongoing,
            completed: bookingCounts.completed,
            cancelled: bookingCounts.cancelled,
        },
        wishlist: {
            count: wishlistCount,
        },
        notifications: {
            unreadCount: unreadNotifications,
        },
    };
}

const getStats = async (req, res) => {
    try {
        const { role, id: userId } = req.user;
        let data;

        if (role === 'ADMIN') {
            data = await getAdminStats();
        } else if (role === 'OWNER') {
            data = await getOwnerStats(userId);
        } else {
            data = await getEndUserStats(req.user);
        }

        res.json({ success: true, data });
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
