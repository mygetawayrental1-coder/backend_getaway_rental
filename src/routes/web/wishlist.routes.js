const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/web/wishlist.web.controller');
const { authenticate } = require('../../middleware/auth');

router.get('/', authenticate, ctrl.listWishlist);
router.post('/:propertyId/toggle', authenticate, ctrl.toggle);
router.post('/:propertyId', authenticate, ctrl.add);
router.delete('/:propertyId', authenticate, ctrl.remove);

module.exports = router;
