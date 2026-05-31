const express = require('express');
const router = express.Router();
const supportTicketController = require('../controllers/supportTicket.controller');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireAdmin, ROLES } = require('../middleware/roles');

router.post(
    '/tickets',
    authenticate,
    requireRole(ROLES.OWNER, ROLES.END_USER),
    supportTicketController.createTicket,
);
router.get('/tickets', authenticate, supportTicketController.getMyTickets);
router.get(
    '/admin/tickets',
    authenticate,
    requireAdmin,
    supportTicketController.getAllTickets,
);
router.get('/tickets/:id', authenticate, supportTicketController.getTicketById);
router.post('/tickets/:id/reply', authenticate, supportTicketController.replyToTicket);
router.patch(
    '/tickets/:id/status',
    authenticate,
    requireAdmin,
    supportTicketController.updateTicketStatus,
);

module.exports = router;
