const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/checkoutField.controller');
const { authenticate } = require('../middleware/auth');
const { requireRole, ROLES } = require('../middleware/roles');

router.get('/', ctrl.listPublic);
router.get('/admin', authenticate, requireRole(ROLES.ADMIN), ctrl.listAdmin);
router.put(
    '/meta/standards',
    authenticate,
    requireRole(ROLES.ADMIN),
    ctrl.upsertStandardsMeta,
);
router.post('/', authenticate, requireRole(ROLES.ADMIN), ctrl.create);
router.put('/:id', authenticate, requireRole(ROLES.ADMIN), ctrl.update);
router.delete('/:id', authenticate, requireRole(ROLES.ADMIN), ctrl.remove);

module.exports = router;
