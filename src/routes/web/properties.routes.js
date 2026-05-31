const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/web/properties.web.controller');
const { authenticate } = require('../../middleware/auth');

router.get('/featured', ctrl.getFeatured);
router.get('/slug/:slug', ctrl.getBySlug);
router.get('/', ctrl.searchProperties);
router.get('/:id/reviews', ctrl.getReviews);
router.post('/:id/reviews', authenticate, ctrl.createReview);
router.get('/:id/bookings', ctrl.getPropertyBookings);

module.exports = router;
