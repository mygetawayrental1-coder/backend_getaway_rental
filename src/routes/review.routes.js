const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/review.controller');
const { authenticate } = require('../middleware/auth');
const { requireOwner } = require('../middleware/roles');

// Owner-only — reviews belong to the property owner, not the admin.
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
    '/:id/visibility',
    authenticate,
    requireOwner,
    reviewController.setReviewVisibility,
);
router.delete(
    '/:id',
    authenticate,
    requireOwner,
    reviewController.deleteReview,
);

module.exports = router;
