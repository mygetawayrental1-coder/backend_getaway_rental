const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/web/pageHero.web.controller');
const { authenticate } = require('../../middleware/auth');
const { isAdmin } = require('../../middleware/roles');

router.get('/admin/all', authenticate, isAdmin, ctrl.listAdmin);
router.patch('/admin/:pageKey', authenticate, isAdmin, ctrl.updateAdmin);
router.get('/', ctrl.listPublic);
router.get('/:pageKey', ctrl.getByKey);

module.exports = router;
