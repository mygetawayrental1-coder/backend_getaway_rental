const prisma = require('../config/database');
const { getPagination, formatPaginatedResponse } = require('../utils/helpers');
const {
    createNotification,
    createTypedNotification,
    NOTIFICATION_TYPES,
} = require('../services/notification.service');

const reviewInclude = {
    property: {
        select: {
            id: true,
            propertyId: true,
            propertyName: true,
            ownerId: true,
        },
    },
    author: {
        select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
        },
    },
};

async function findReviewById(id) {
    return prisma.review.findUnique({
        where: { id },
        include: reviewInclude,
    });
}

/**
 * POST /reviews/:id/reply
 */
const replyToReview = async (req, res) => {
    try {
        const { id } = req.params;
        const { reply } = req.body;

        if (!reply || !String(reply).trim()) {
            return res.status(400).json({
                success: false,
                message: 'reply is required.',
            });
        }

        const review = await findReviewById(id);
        if (!review) {
            return res.status(404).json({ success: false, message: 'Review not found.' });
        }

        if (review.property.ownerId !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const updated = await prisma.review.update({
            where: { id: review.id },
            data: {
                ownerReply: String(reply).trim(),
                ownerRepliedAt: new Date(),
            },
            include: reviewInclude,
        });

        if (review.authorId) {
            try {
                await createTypedNotification({
                    userId: review.authorId,
                    type: NOTIFICATION_TYPES.REVIEW_REPLY,
                    data: {
                        reviewId: review.id,
                        propertyId: review.propertyId,
                    },
                    vars: { propertyName: review.property.propertyName },
                });
            } catch (notifyErr) {
                console.error('Review reply notification error:', notifyErr);
            }
        }

        res.json({ success: true, review: updated });
    } catch (error) {
        console.error('Reply to review error:', error);
        res.status(500).json({ success: false, message: 'Failed to reply to review.' });
    }
};

/**
 * PATCH /reviews/:id/approve
 */
const approveReview = async (req, res) => {
    try {
        const { id } = req.params;

        const review = await findReviewById(id);
        if (!review) {
            return res.status(404).json({ success: false, message: 'Review not found.' });
        }

        const updated = await prisma.review.update({
            where: { id: review.id },
            data: { isApproved: true },
            include: reviewInclude,
        });

        try {
            await createNotification({
                userId: review.property.ownerId,
                type: NOTIFICATION_TYPES.REVIEW_NEW,
                title: `New review approved for ${review.property.propertyName}`,
                body: `A new review has been approved for ${review.property.propertyName}.`,
                data: {
                    reviewId: review.id,
                    propertyId: review.propertyId,
                },
            });
        } catch (notifyErr) {
            console.error('Review approve notification error:', notifyErr);
        }

        res.json({ success: true, review: updated });
    } catch (error) {
        console.error('Approve review error:', error);
        res.status(500).json({ success: false, message: 'Failed to approve review.' });
    }
};

/**
 * DELETE /reviews/:id
 */
const rejectReview = async (req, res) => {
    try {
        const { id } = req.params;

        const review = await prisma.review.findUnique({ where: { id } });
        if (!review) {
            return res.status(404).json({ success: false, message: 'Review not found.' });
        }

        await prisma.review.delete({ where: { id: review.id } });

        res.json({ success: true });
    } catch (error) {
        console.error('Reject review error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete review.' });
    }
};

/**
 * GET /reviews/pending
 */
const getAllReviewsForModeration = async (req, res) => {
    try {
        const { page, limit, skip } = getPagination(req.query);

        const where = { isApproved: false };

        const [reviews, total] = await Promise.all([
            prisma.review.findMany({
                where,
                include: reviewInclude,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            prisma.review.count({ where }),
        ]);

        res.json({
            success: true,
            ...formatPaginatedResponse(reviews, total, page, limit),
        });
    } catch (error) {
        console.error('Get pending reviews error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch pending reviews.' });
    }
};

/**
 * GET /reviews/my-properties
 */
const getMyPropertyReviews = async (req, res) => {
    try {
        const { propertyId } = req.query;
        const { page, limit, skip } = getPagination(req.query);

        const where = {
            isApproved: true,
            property: {
                ownerId: req.user.id,
                ...(propertyId ? { OR: [{ id: propertyId }, { propertyId }] } : {}),
            },
        };

        const [reviews, total] = await Promise.all([
            prisma.review.findMany({
                where,
                include: reviewInclude,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            prisma.review.count({ where }),
        ]);

        res.json({
            success: true,
            ...formatPaginatedResponse(reviews, total, page, limit),
        });
    } catch (error) {
        console.error('Get my property reviews error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch reviews.' });
    }
};

/**
 * GET /reviews/approved
 */
const getApprovedReviews = async (req, res) => {
    try {
        const { page, limit, skip } = getPagination(req.query);

        const where = { isApproved: true };

        const [reviews, total] = await Promise.all([
            prisma.review.findMany({
                where,
                include: reviewInclude,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            prisma.review.count({ where }),
        ]);

        res.json({
            success: true,
            ...formatPaginatedResponse(reviews, total, page, limit),
        });
    } catch (error) {
        console.error('Get approved reviews error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch approved reviews.' });
    }
};

module.exports = {
    replyToReview,
    approveReview,
    rejectReview,
    getAllReviewsForModeration,
    getApprovedReviews,
    getMyPropertyReviews,
};
