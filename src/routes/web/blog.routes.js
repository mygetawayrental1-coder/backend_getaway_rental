const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/web/blog.web.controller');
const { authenticate } = require('../../middleware/auth');
const { isAdmin } = require('../../middleware/roles');

router.get('/admin/all', authenticate, isAdmin, ctrl.listAllAdmin);
router.get('/admin/:id', authenticate, isAdmin, ctrl.getByIdAdmin);
router.get('/', ctrl.listPublished);
router.post('/', authenticate, isAdmin, ctrl.createPost);
router.patch('/:id', authenticate, isAdmin, ctrl.updatePost);
router.delete('/:id', authenticate, isAdmin, ctrl.deletePost);
router.get('/:slug', ctrl.getBySlug);

module.exports = router;
