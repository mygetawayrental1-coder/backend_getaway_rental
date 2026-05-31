const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/review.controller');
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requireOwner } = require('../middleware/roles');

router.get(
    '/pending',
    authenticate,
    requireAdmin,
    reviewController.getAllReviewsForModeration,
);
router.get(
    '/approved',
    authenticate,
    requireAdmin,
    reviewController.getApprovedReviews,
);
router.get(
    '/my-properties',
    authenticate,
    requireOwner,
    reviewController.getMyPropertyReviews,
);
router.post(
    '/:id/reply',
    authenticate,
    requireOwner,
    reviewController.replyToReview,
);
router.patch(
    '/:id/approve',
    authenticate,
    requireAdmin,
    reviewController.approveReview,
);
router.delete(
    '/:id',
    authenticate,
    requireAdmin,
    reviewController.rejectReview,
);

module.exports = router;
