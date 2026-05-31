const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/web/contact.web.controller');
const { authenticate } = require('../../middleware/auth');
const { isAdmin } = require('../../middleware/roles');

router.post('/', ctrl.submit);
router.get('/messages', authenticate, isAdmin, ctrl.listMessages);
router.patch('/messages/:id/read', authenticate, isAdmin, ctrl.toggleRead);

module.exports = router;
