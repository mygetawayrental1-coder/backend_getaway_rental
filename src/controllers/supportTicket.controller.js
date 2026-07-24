const prisma = require('../config/database');
const { getPagination, formatPaginatedResponse } = require('../utils/helpers');
const { verifyCaptcha } = require('./captcha.controller');
const { createTypedNotification, NOTIFICATION_TYPES } = require('../services/notification.service');
const { ROLES } = require('../middleware/roles');

const CATEGORIES = ['booking', 'payout', 'property', 'account', 'other'];
const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

function getTicketOwnerSelect() {
    return {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        countryCode: true,
        phoneNumber: true,
        address: true,
        profilePic: true,
        isActive: true,
        createdAt: true,
        ownedProperties: {
            select: {
                id: true,
                propertyId: true,
                propertyName: true,
                location: true,
                status: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 25,
        },
        subscriptions: {
            where: {
                status: { in: ['ACTIVE', 'Active'] },
            },
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                status: true,
                endDate: true,
                startDate: true,
                plan: {
                    select: {
                        id: true,
                        name: true,
                        maxProperties: true,
                        duration: true,
                    },
                },
            },
        },
    };
}

function shapeTicketOwner(user) {
    if (!user) return null;
    const { ownedProperties = [], subscriptions = [], ...rest } = user;
    const activeSub = subscriptions[0] || null;
    return {
        ...rest,
        fullName: [rest.firstName, rest.lastName].filter(Boolean).join(' ').trim() || rest.email,
        phone:
            rest.phoneNumber
                ? `${rest.countryCode ? `${rest.countryCode} ` : ''}${rest.phoneNumber}`.trim()
                : null,
        properties: ownedProperties,
        propertyCount: ownedProperties.length,
        subscription: activeSub
            ? {
                  id: activeSub.id,
                  status: activeSub.status,
                  startDate: activeSub.startDate,
                  endDate: activeSub.endDate,
                  planName: activeSub.plan?.name || null,
                  maxProperties: activeSub.plan?.maxProperties ?? null,
                  duration: activeSub.plan?.duration || null,
              }
            : null,
    };
}

async function findTicketByParam(id) {
    return prisma.supportTicket.findFirst({
        where: { OR: [{ id }, { ticketId: id }] },
        include: {
            user: { select: getTicketOwnerSelect() },
        },
    });
}

function canViewTicket(user, ticket) {
    if (!ticket || !user) return false;
    if (user.role === ROLES.ADMIN) return true;
    return ticket.userId === user.id;
}

async function notifyAdmins(type, data, vars) {
    const admins = await prisma.user.findMany({
        where: { role: ROLES.ADMIN, isActive: true },
        select: { id: true },
    });
    await Promise.all(
        admins.map((admin) =>
            createTypedNotification({ userId: admin.id, type, data, vars }).catch((err) => {
                console.error('Support admin notification error:', err);
            }),
        ),
    );
}

/**
 * POST /support/tickets
 */
const createTicket = async (req, res) => {
    try {
        const { subject, category, description, priority, captchaId, captchaCode } = req.body;

        if (!(await verifyCaptcha(captchaId, captchaCode))) {
            return res.status(400).json({ success: false, message: 'Invalid or expired security code.' });
        }

        if (!subject?.trim() || !category || !description?.trim()) {
            return res.status(400).json({
                success: false,
                message: 'subject, category, and description are required.',
            });
        }

        const cat = String(category).toLowerCase();
        if (!CATEGORIES.includes(cat)) {
            return res.status(400).json({
                success: false,
                message: `category must be one of: ${CATEGORIES.join(', ')}`,
            });
        }

        const pri = priority ? String(priority).toUpperCase() : 'MEDIUM';
        if (!PRIORITIES.includes(pri)) {
            return res.status(400).json({
                success: false,
                message: `priority must be one of: ${PRIORITIES.join(', ')}`,
            });
        }

        const ticket = await prisma.supportTicket.create({
            data: {
                userId: req.user.id,
                subject: subject.trim(),
                category: cat,
                description: description.trim(),
                priority: pri,
                status: 'OPEN',
            },
        });

        try {
            const submitterName =
                [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || req.user.email;
            await notifyAdmins(
                NOTIFICATION_TYPES.SUPPORT_TICKET_NEW,
                {
                    ticketId: ticket.id,
                    publicTicketId: ticket.ticketId,
                    userId: req.user.id,
                    category: cat,
                    priority: pri,
                },
                { subject: ticket.subject, submitterName },
            );
        } catch (notifyErr) {
            console.error('Support ticket create notification error:', notifyErr);
        }

        res.status(201).json({ success: true, data: ticket });
    } catch (error) {
        console.error('Create support ticket error:', error);
        res.status(500).json({ success: false, message: 'Failed to create support ticket.' });
    }
};

/**
 * GET /support/tickets
 */
const getMyTickets = async (req, res) => {
    try {
        const { status, page, limit } = req.query;
        const pagination = getPagination(page, limit);

        const where = { userId: req.user.id };
        if (status) where.status = String(status).toUpperCase();

        const [rows, total] = await Promise.all([
            prisma.supportTicket.findMany({
                where,
                skip: pagination.skip,
                take: pagination.take,
                orderBy: { createdAt: 'desc' },
                include: {
                    _count: { select: { replies: true } },
                },
            }),
            prisma.supportTicket.count({ where }),
        ]);

        const data = rows.map(({ _count, ...ticket }) => ({
            ...ticket,
            replyCount: _count.replies,
        }));

        res.json({
            success: true,
            ...formatPaginatedResponse(data, total, pagination.page, pagination.limit),
        });
    } catch (error) {
        console.error('Get my tickets error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch tickets.' });
    }
};

/**
 * GET /support/tickets/:id
 */
const getTicketById = async (req, res) => {
    try {
        const ticket = await findTicketByParam(req.params.id);

        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found.' });
        }

        if (!canViewTicket(req.user, ticket)) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const replies = await prisma.ticketReply.findMany({
            where: { ticketId: ticket.id },
            orderBy: { createdAt: 'asc' },
        });

        const { user, ...ticketData } = ticket;

        res.json({
            success: true,
            data: {
                ...ticketData,
                user: req.user.role === ROLES.ADMIN ? shapeTicketOwner(user) : undefined,
                replies,
            },
        });
    } catch (error) {
        console.error('Get ticket by id error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch ticket.' });
    }
};

/**
 * POST /support/tickets/:id/reply
 */
const replyToTicket = async (req, res) => {
    try {
        const { content, captchaId, captchaCode } = req.body;
        const isAdmin = req.user.role === ROLES.ADMIN;

        // Owners must pass captcha; admins reply from the portal without it.
        if (!isAdmin && !(await verifyCaptcha(captchaId, captchaCode))) {
            return res.status(400).json({ success: false, message: 'Invalid or expired security code.' });
        }

        if (!content?.trim()) {
            return res.status(400).json({ success: false, message: 'content is required.' });
        }

        const ticket = await findTicketByParam(req.params.id);
        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found.' });
        }

        if (!isAdmin && ticket.userId !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        if (!isAdmin && ticket.status === 'CLOSED') {
            return res.status(400).json({
                success: false,
                message: 'This ticket is closed. Please create a new support ticket.',
            });
        }

        const reply = await prisma.ticketReply.create({
            data: {
                ticketId: ticket.id,
                authorId: req.user.id,
                content: content.trim(),
                isAdmin,
            },
        });

        if (isAdmin && ticket.status === 'OPEN') {
            await prisma.supportTicket.update({
                where: { id: ticket.id },
                data: { status: 'IN_PROGRESS' },
            });
        }

        // Owner follow-up on a resolved ticket reopens it for admin review.
        if (!isAdmin && ticket.status === 'RESOLVED') {
            await prisma.supportTicket.update({
                where: { id: ticket.id },
                data: { status: 'OPEN', resolvedAt: null },
            });
        }

        try {
            if (isAdmin) {
                await createTypedNotification({
                    userId: ticket.userId,
                    type: NOTIFICATION_TYPES.SUPPORT_TICKET_REPLY,
                    data: { ticketId: ticket.id, publicTicketId: ticket.ticketId, replyId: reply.id },
                    vars: { subject: ticket.subject },
                });
            } else {
                await notifyAdmins(
                    NOTIFICATION_TYPES.SUPPORT_TICKET_REPLY,
                    {
                        ticketId: ticket.id,
                        publicTicketId: ticket.ticketId,
                        replyId: reply.id,
                        userId: ticket.userId,
                    },
                    {
                        subject: ticket.subject,
                        submitterName:
                            [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') ||
                            req.user.email,
                    },
                );
            }
        } catch (notifyErr) {
            console.error('Support ticket reply notification error:', notifyErr);
        }

        res.status(201).json({ success: true, data: reply });
    } catch (error) {
        console.error('Reply to ticket error:', error);
        res.status(500).json({ success: false, message: 'Failed to post reply.' });
    }
};

/**
 * PATCH /support/tickets/:id/status
 */
const updateTicketStatus = async (req, res) => {
    try {
        const { status, adminNotes } = req.body;

        if (!status) {
            return res.status(400).json({ success: false, message: 'status is required.' });
        }

        const nextStatus = String(status).toUpperCase();
        if (!STATUSES.includes(nextStatus)) {
            return res.status(400).json({
                success: false,
                message: `status must be one of: ${STATUSES.join(', ')}`,
            });
        }

        const ticket = await findTicketByParam(req.params.id);
        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found.' });
        }

        const updateData = { status: nextStatus };
        if (adminNotes !== undefined) updateData.adminNotes = adminNotes || null;
        if (nextStatus === 'RESOLVED') updateData.resolvedAt = new Date();

        const updated = await prisma.supportTicket.update({
            where: { id: ticket.id },
            data: updateData,
        });

        try {
            await createTypedNotification({
                userId: ticket.userId,
                type: NOTIFICATION_TYPES.SUPPORT_TICKET_STATUS,
                data: {
                    ticketId: ticket.id,
                    publicTicketId: ticket.ticketId,
                    status: nextStatus,
                },
                vars: { subject: ticket.subject, status: nextStatus },
            });
        } catch (notifyErr) {
            console.error('Support ticket status notification error:', notifyErr);
        }

        res.json({ success: true, data: updated });
    } catch (error) {
        console.error('Update ticket status error:', error);
        res.status(500).json({ success: false, message: 'Failed to update ticket status.' });
    }
};

/**
 * GET /support/admin/tickets
 */
const getAllTickets = async (req, res) => {
    try {
        const { status, priority, category, page, limit } = req.query;
        const pagination = getPagination(page, limit, { maxLimit: 500 });

        const where = {};
        if (status) where.status = String(status).toUpperCase();
        if (priority) where.priority = String(priority).toUpperCase();
        if (category) where.category = String(category).toLowerCase();

        const [rows, total] = await Promise.all([
            prisma.supportTicket.findMany({
                where,
                skip: pagination.skip,
                take: pagination.take,
                orderBy: { createdAt: 'desc' },
                include: {
                    user: { select: getTicketOwnerSelect() },
                    _count: { select: { replies: true } },
                },
            }),
            prisma.supportTicket.count({ where }),
        ]);

        const data = rows.map(({ _count, user, ...ticket }) => ({
            ...ticket,
            user: shapeTicketOwner(user),
            replyCount: _count.replies,
        }));

        res.json({
            success: true,
            ...formatPaginatedResponse(data, total, pagination.page, pagination.limit),
        });
    } catch (error) {
        console.error('Get all tickets error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch tickets.' });
    }
};

/**
 * PATCH /support/tickets/:id
 * Admin edit of ticket fields (subject, category, description, priority, adminNotes).
 */
const updateTicket = async (req, res) => {
    try {
        const ticket = await findTicketByParam(req.params.id);
        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found.' });
        }

        const body = req.body || {};
        const data = {};

        if (body.subject !== undefined) {
            const subject = String(body.subject || '').trim();
            if (!subject) {
                return res.status(400).json({ success: false, message: 'Subject cannot be empty.' });
            }
            data.subject = subject;
        }

        if (body.description !== undefined) {
            const description = String(body.description || '').trim();
            if (!description) {
                return res.status(400).json({ success: false, message: 'Description cannot be empty.' });
            }
            data.description = description;
        }

        if (body.category !== undefined) {
            const category = String(body.category || '').toLowerCase().trim();
            if (!CATEGORIES.includes(category)) {
                return res.status(400).json({
                    success: false,
                    message: `category must be one of: ${CATEGORIES.join(', ')}`,
                });
            }
            data.category = category;
        }

        if (body.priority !== undefined) {
            const priority = String(body.priority || '').toUpperCase();
            if (!PRIORITIES.includes(priority)) {
                return res.status(400).json({
                    success: false,
                    message: `priority must be one of: ${PRIORITIES.join(', ')}`,
                });
            }
            data.priority = priority;
        }

        if (body.adminNotes !== undefined) {
            data.adminNotes = body.adminNotes ? String(body.adminNotes) : null;
        }

        if (Object.keys(data).length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update.' });
        }

        const updated = await prisma.supportTicket.update({
            where: { id: ticket.id },
            data,
            include: {
                user: { select: getTicketOwnerSelect() },
                _count: { select: { replies: true } },
            },
        });

        const { _count, user, ...rest } = updated;
        res.json({
            success: true,
            data: {
                ...rest,
                user: shapeTicketOwner(user),
                replyCount: _count.replies,
            },
        });
    } catch (error) {
        console.error('Update ticket error:', error);
        res.status(500).json({ success: false, message: 'Failed to update ticket.' });
    }
};

/**
 * DELETE /support/tickets/:id
 * Admin delete — removes ticket and cascaded replies.
 */
const deleteTicket = async (req, res) => {
    try {
        const ticket = await findTicketByParam(req.params.id);
        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found.' });
        }

        await prisma.supportTicket.delete({ where: { id: ticket.id } });

        res.json({ success: true, message: 'Ticket deleted.' });
    } catch (error) {
        console.error('Delete ticket error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete ticket.' });
    }
};

module.exports = {
    createTicket,
    getMyTickets,
    getTicketById,
    replyToTicket,
    updateTicketStatus,
    updateTicket,
    deleteTicket,
    getAllTickets,
};
