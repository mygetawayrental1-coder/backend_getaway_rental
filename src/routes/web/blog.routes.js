const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/web/blog.web.controller');
const { authenticate } = require('../../middleware/auth');
const { isAdmin } = require('../../middleware/roles');

router.get('/', ctrl.listPublished);
router.post('/', authenticate, isAdmin, ctrl.createPost);
router.get('/:slug', ctrl.getBySlug);

module.exports = router;
