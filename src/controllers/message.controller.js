const prisma = require('../config/database');
const { getPagination, formatPaginatedResponse, stringifyJsonField, parseJsonField } = require('../utils/helpers');
const { createTypedNotification, NOTIFICATION_TYPES } = require('../services/notification.service');

function normalizeEmail(email) {
    return email ? String(email).trim().toLowerCase() : null;
}

async function resolveProperty(propertyId) {
    return prisma.property.findFirst({
        where: { OR: [{ id: propertyId }, { propertyId }] },
        select: {
            id: true,
            propertyId: true,
            propertyName: true,
            ownerId: true,
        },
    });
}

function formatMessage(row) {
    if (!row) return null;
    return {
        ...row,
        attachment: parseJsonField(row.attachment),
    };
}

function isConversationOwner(user, conversation) {
    return user && conversation.ownerId === user.id;
}

function isConversationGuest(user, conversation) {
    if (!user) return false;
    if (conversation.guestId && conversation.guestId === user.id) return true;
    if (
        conversation.guestEmail &&
        user.email &&
        normalizeEmail(conversation.guestEmail) === normalizeEmail(user.email)
    ) {
        return true;
    }
    return false;
}

function isAnonymousGuest(conversation, senderEmail) {
    const email = normalizeEmail(senderEmail);
    return (
        !conversation.guestId &&
        email &&
        conversation.guestEmail &&
        normalizeEmail(conversation.guestEmail) === email
    );
}

function canAccessConversation(user, conversation, { senderEmail } = {}) {
    if (!conversation) return false;
    if (user?.role === 'ADMIN') return true;
    if (isConversationOwner(user, conversation)) return true;
    if (isConversationGuest(user, conversation)) return true;
    if (isAnonymousGuest(conversation, senderEmail)) return true;
    return false;
}

async function findExistingConversation(propertyId, ownerId, guestId, guestEmail) {
    if (guestId) {
        const byGuestId = await prisma.conversation.findFirst({
            where: { propertyId, ownerId, guestId },
        });
        if (byGuestId) return byGuestId;
    }

    const email = normalizeEmail(guestEmail);
    if (email) {
        return prisma.conversation.findFirst({
            where: { propertyId, ownerId, guestEmail: email },
        });
    }

    return null;
}

async function notifyMessageRecipient(conversation, property, senderLabel, receiverUserId) {
    if (!receiverUserId) return;
    await createTypedNotification({
        userId: receiverUserId,
        type: NOTIFICATION_TYPES.MESSAGE_NEW,
        data: {
            conversationId: conversation.id,
            propertyId: property?.id || conversation.propertyId,
            propertyName: property?.propertyName,
        },
        vars: { senderName: senderLabel, propertyName: property?.propertyName },
    });
}

async function loadConversation(conversationId) {
    return prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
            property: { select: { id: true, propertyName: true, slug: true } },
        },
    });
}

/**
 * POST /messages/conversations
 */
const getOrCreateConversation = async (req, res) => {
    try {
        const { propertyId, bookingId, message, senderName, senderEmail } = req.body;

        if (!propertyId || !message || !String(message).trim()) {
            return res.status(400).json({
                success: false,
                message: 'propertyId and message are required.',
            });
        }

        const property = await resolveProperty(propertyId);
        if (!property) {
            return res.status(404).json({ success: false, message: 'Property not found.' });
        }

        const guestId = req.user?.id || null;
        const guestEmailNorm = normalizeEmail(senderEmail) || normalizeEmail(req.user?.email);

        if (!guestId && !guestEmailNorm) {
            return res.status(400).json({
                success: false,
                message: 'senderEmail is required when not signed in.',
            });
        }

        if (!guestId && !String(senderName || '').trim()) {
            return res.status(400).json({
                success: false,
                message: 'senderName is required when not signed in.',
            });
        }

        if (bookingId) {
            const booking = await prisma.booking.findFirst({
                where: {
                    OR: [{ id: bookingId }, { bookingId }],
                    propertyId: property.id,
                },
            });
            if (!booking) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid bookingId for this property.',
                });
            }
        }

        let conversation = await findExistingConversation(
            property.id,
            property.ownerId,
            guestId,
            guestEmailNorm,
        );

        const senderDisplayName = req.user
            ? [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || req.user.email
            : String(senderName).trim();

        const messagePayload = {
            content: String(message).trim(),
            senderId: guestId,
            receiverId: property.ownerId,
            senderName: guestId ? null : senderDisplayName,
            senderEmail: guestId ? null : guestEmailNorm,
        };

        let createdMessage;
        let isNewConversation = false;

        if (!conversation) {
            isNewConversation = true;
            const participantConnect = [{ id: property.ownerId }];
            if (guestId) participantConnect.push({ id: guestId });

            conversation = await prisma.conversation.create({
                data: {
                    propertyId: property.id,
                    bookingId: bookingId || null,
                    ownerId: property.ownerId,
                    guestId,
                    guestEmail: guestEmailNorm,
                    lastMessageAt: new Date(),
                    participants: { connect: participantConnect },
                    messages: { create: messagePayload },
                },
                include: {
                    property: { select: { propertyName: true, slug: true } },
                    messages: { orderBy: { createdAt: 'desc' }, take: 1 },
                },
            });
            createdMessage = conversation.messages[0];
        } else {
            createdMessage = await prisma.message.create({
                data: {
                    conversationId: conversation.id,
                    ...messagePayload,
                },
            });
            conversation = await prisma.conversation.update({
                where: { id: conversation.id },
                data: {
                    lastMessageAt: new Date(),
                    bookingId: bookingId || undefined,
                },
                include: {
                    property: { select: { propertyName: true, slug: true } },
                },
            });
        }

        try {
            await notifyMessageRecipient(
                conversation,
                property,
                senderDisplayName,
                property.ownerId,
            );
        } catch (notifyErr) {
            console.error('New conversation message notification error:', notifyErr);
        }

        res.status(isNewConversation ? 201 : 200).json({
            success: true,
            data: {
                conversation: {
                    id: conversation.id,
                    propertyId: conversation.propertyId,
                    bookingId: conversation.bookingId,
                    ownerId: conversation.ownerId,
                    guestId: conversation.guestId,
                    guestEmail: conversation.guestEmail,
                    lastMessageAt: conversation.lastMessageAt,
                    property: conversation.property,
                },
                message: formatMessage(createdMessage),
            },
        });
    } catch (error) {
        console.error('Get or create conversation error:', error);
        res.status(500).json({ success: false, message: 'Failed to start conversation.' });
    }
};

/**
 * GET /messages/conversations
 */
const getConversations = async (req, res) => {
    try {
        const { page, limit } = req.query;
        const pagination = getPagination(page, limit);
        const user = req.user;

        let where;
        if (user.role === 'OWNER') {
            where = { ownerId: user.id };
        } else {
            where = {
                OR: [
                    { guestId: user.id },
                    ...(user.email
                        ? [{ guestEmail: normalizeEmail(user.email) }]
                        : []),
                ],
            };
        }

        const [rows, total] = await Promise.all([
            prisma.conversation.findMany({
                where,
                skip: pagination.skip,
                take: pagination.take,
                orderBy: { lastMessageAt: 'desc' },
                include: {
                    property: {
                        select: { propertyName: true, slug: true, images: true },
                    },
                    messages: {
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                    },
                },
            }),
            prisma.conversation.count({ where }),
        ]);

        const data = await Promise.all(
            rows.map(async (c) => {
                const unreadCount = await prisma.message.count({
                    where: {
                        conversationId: c.id,
                        receiverId: user.id,
                        isRead: false,
                    },
                });
                const last = c.messages[0];
                return {
                    id: c.id,
                    propertyId: c.propertyId,
                    bookingId: c.bookingId,
                    ownerId: c.ownerId,
                    guestId: c.guestId,
                    guestEmail: c.guestEmail,
                    lastMessageAt: c.lastMessageAt,
                    property: c.property,
                    lastMessage: last ? formatMessage(last) : null,
                    unreadCount,
                };
            }),
        );

        res.json({
            success: true,
            ...formatPaginatedResponse(data, total, pagination.page, pagination.limit),
        });
    } catch (error) {
        console.error('Get conversations error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch conversations.' });
    }
};

/**
 * GET /messages/conversations/:conversationId
 */
const getMessages = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { page, limit } = req.query;
        const pagination = getPagination(page, limit);

        const conversation = await loadConversation(conversationId);
        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found.' });
        }

        if (!canAccessConversation(req.user, conversation)) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const where = { conversationId: conversation.id };

        const [messages, total] = await Promise.all([
            prisma.message.findMany({
                where,
                skip: pagination.skip,
                take: pagination.take,
                orderBy: { createdAt: 'asc' },
            }),
            prisma.message.count({ where }),
        ]);

        await prisma.message.updateMany({
            where: {
                conversationId: conversation.id,
                receiverId: req.user.id,
                isRead: false,
            },
            data: { isRead: true, readAt: new Date() },
        });

        res.json({
            success: true,
            conversation: {
                id: conversation.id,
                propertyId: conversation.propertyId,
                bookingId: conversation.bookingId,
                property: conversation.property,
            },
            ...formatPaginatedResponse(
                messages.map(formatMessage),
                total,
                pagination.page,
                pagination.limit,
            ),
        });
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch messages.' });
    }
};

/**
 * POST /messages/conversations/:conversationId
 */
const sendMessage = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { content, attachment, senderEmail, senderName } = req.body;

        if (!content || !String(content).trim()) {
            return res.status(400).json({
                success: false,
                message: 'content is required.',
            });
        }

        const conversation = await loadConversation(conversationId);
        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found.' });
        }

        if (!canAccessConversation(req.user, conversation, { senderEmail })) {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const user = req.user;
        const isOwner = isConversationOwner(user, conversation);
        const isGuest = isConversationGuest(user, conversation);
        const isAnon = isAnonymousGuest(conversation, senderEmail);

        let senderId = null;
        let receiverId = null;
        let msgSenderName = null;
        let msgSenderEmail = null;
        let senderLabel = 'Someone';

        if (isOwner) {
            senderId = user.id;
            receiverId = conversation.guestId;
            senderLabel = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
        } else if (isGuest && user) {
            senderId = user.id;
            receiverId = conversation.ownerId;
            senderLabel = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
        } else if (isAnon) {
            msgSenderName = String(senderName || '').trim() || 'Guest';
            msgSenderEmail = normalizeEmail(senderEmail);
            receiverId = conversation.ownerId;
            senderLabel = msgSenderName;
        } else {
            return res.status(403).json({ success: false, message: 'Access denied.' });
        }

        const message = await prisma.message.create({
            data: {
                conversationId: conversation.id,
                senderId,
                receiverId,
                senderName: msgSenderName,
                senderEmail: msgSenderEmail,
                content: String(content).trim(),
                attachment: attachment != null ? stringifyJsonField(attachment) : null,
            },
        });

        await prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: new Date() },
        });

        try {
            await notifyMessageRecipient(
                conversation,
                conversation.property,
                senderLabel,
                receiverId,
            );
        } catch (notifyErr) {
            console.error('Send message notification error:', notifyErr);
        }

        res.status(201).json({
            success: true,
            data: formatMessage(message),
        });
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ success: false, message: 'Failed to send message.' });
    }
};

/**
 * GET /messages/unread-count
 */
const getUnreadMessageCount = async (req, res) => {
    try {
        const count = await prisma.message.count({
            where: {
                receiverId: req.user.id,
                isRead: false,
            },
        });

        res.json({ success: true, count });
    } catch (error) {
        console.error('Get unread message count error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch unread count.' });
    }
};

module.exports = {
    getOrCreateConversation,
    getConversations,
    getMessages,
    sendMessage,
    getUnreadMessageCount,
};
