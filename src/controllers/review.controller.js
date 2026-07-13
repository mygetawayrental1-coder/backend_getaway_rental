const prisma = require('../config/database');
const { getPagination, formatPaginatedResponse } = require('../utils/helpers');
const { verifyCaptcha } = require('./captcha.controller');
const {
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

function assertPropertyOwner(review, userId) {
    return review?.property?.ownerId === userId;
}

/**
 * POST /reviews/:id/reply — property owner only
 */
const replyToReview = async (req, res) => {
    try {
        const { id } = req.params;
        const { reply, captchaId, captchaCode } = req.body;

        if (!(await verifyCaptcha(captchaId, captchaCode))) {
            return res.status(400).json({ success: false, message: 'Invalid or expired security code.' });
        }

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

        if (!assertPropertyOwner(review, req.user.id)) {
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
 * PATCH /reviews/:id/visibility
 * Body: { published: true | false }
 * Owner publishes (shows on property page) or hides the review.
 */
const setReviewVisibility = async (req, res) => {
    try {
        const { id } = req.params;
        const published = req.body?.published;

        if (typeof published !== 'boolean') {
            return res.status(400).json({
                success: false,
                message: 'published (boolean) is required.',
            });
        }

        const review = await findReviewById(id);
        if (!review) {
            return res.status(404).json({ success: false, message: 'Review not found.' });
        }

        if (!assertPropertyOwner(review, req.user.id)) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const updated = await prisma.review.update({
            where: { id: review.id },
            data: { isApproved: published },
            include: reviewInclude,
        });

        res.json({
            success: true,
            message: published
                ? 'Review is now visible on the property page.'
                : 'Review hidden from the property page.',
            review: updated,
        });
    } catch (error) {
        console.error('Set review visibility error:', error);
        res.status(500).json({ success: false, message: 'Failed to update review visibility.' });
    }
};

/**
 * DELETE /reviews/:id — property owner only
 */
const deleteReview = async (req, res) => {
    try {
        const { id } = req.params;

        const review = await findReviewById(id);
        if (!review) {
            return res.status(404).json({ success: false, message: 'Review not found.' });
        }

        if (!assertPropertyOwner(review, req.user.id)) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        await prisma.review.delete({ where: { id: review.id } });

        res.json({ success: true, message: 'Review deleted.' });
    } catch (error) {
        console.error('Delete review error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete review.' });
    }
};

/**
 * GET /reviews/my-properties
 * All reviews for the owner's properties (pending + published).
 * Query: status=published | hidden | all (default all)
 */
const getMyPropertyReviews = async (req, res) => {
    try {
        const { propertyId, status } = req.query;
        const { page, limit, skip } = getPagination(req.query.page, req.query.limit);

        const where = {
            property: {
                ownerId: req.user.id,
                ...(propertyId ? { OR: [{ id: propertyId }, { propertyId }] } : {}),
            },
        };

        if (status === 'published') where.isApproved = true;
        else if (status === 'hidden') where.isApproved = false;

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

module.exports = {
    replyToReview,
    setReviewVisibility,
    deleteReview,
    getMyPropertyReviews,
};
