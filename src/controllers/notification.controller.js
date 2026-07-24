const prisma = require('../config/database');
const { getPagination, formatPaginatedResponse } = require('../utils/helpers');
const { formatNotification, parseUnreadOnly } = require('../services/notification.service');
const { sendBroadcastEmail } = require('../services/email.service');

/**
 * GET /notifications
 * Query: page, limit, unreadOnly
 */
const getNotifications = async (req, res) => {
    try {
        const userId = req.user.id;
        const { page, limit, unreadOnly } = req.query;
        const pagination = getPagination(page, limit);
        const onlyUnread = parseUnreadOnly(unreadOnly);

        const where = {
            userId,
            ...(onlyUnread ? { isRead: false } : {}),
        };

        const [rows, total, unreadCount] = await Promise.all([
            prisma.notification.findMany({
                where,
                skip: pagination.skip,
                take: pagination.take,
                orderBy: { createdAt: 'desc' },
            }),
            prisma.notification.count({ where }),
            prisma.notification.count({
                where: { userId, isRead: false },
            }),
        ]);

        res.json({
            success: true,
            unreadCount,
            ...formatPaginatedResponse(
                rows.map(formatNotification),
                total,
                pagination.page,
                pagination.limit,
            ),
        });
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch notifications.',
        });
    }
};

/**
 * GET /notifications/unread-count
 */
const getUnreadCount = async (req, res) => {
    try {
        const count = await prisma.notification.count({
            where: {
                userId: req.user.id,
                isRead: false,
            },
        });

        res.json({
            success: true,
            count,
        });
    } catch (error) {
        console.error('Get unread count error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch unread count.',
        });
    }
};

/**
 * PATCH /notifications/read-all
 */
const markAllRead = async (req, res) => {
    try {
        const now = new Date();
        const result = await prisma.notification.updateMany({
            where: {
                userId: req.user.id,
                isRead: false,
            },
            data: {
                isRead: true,
                readAt: now,
            },
        });

        res.json({
            success: true,
            message: 'All notifications marked as read.',
            updatedCount: result.count,
        });
    } catch (error) {
        console.error('Mark all read error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to mark notifications as read.',
        });
    }
};

/**
 * PATCH /notifications/:id/read
 */
const markRead = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const existing = await prisma.notification.findFirst({
            where: { id, userId },
        });

        if (!existing) {
            return res.status(404).json({
                success: false,
                message: 'Notification not found.',
            });
        }

        if (existing.isRead) {
            return res.json({
                success: true,
                message: 'Notification already read.',
                data: formatNotification(existing),
            });
        }

        const updated = await prisma.notification.update({
            where: { id: existing.id },
            data: {
                isRead: true,
                readAt: new Date(),
            },
        });

        res.json({
            success: true,
            message: 'Notification marked as read.',
            data: formatNotification(updated),
        });
    } catch (error) {
        console.error('Mark read error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to mark notification as read.',
        });
    }
};

/**
 * POST /admin/notifications/broadcast
 * Broadcasts a message to owners, users, or all.
 */
const ALLOWED_AUDIENCES = ['OWNERS', 'END_USERS', 'ALL'];
const ALLOWED_CHANNELS = ['dashboard', 'email'];

const broadcastNotification = async (req, res) => {
    try {
        const { targetAudience, channels, subject, message } = req.body;

        if (!targetAudience || !subject || !message) {
            return res.status(400).json({ success: false, message: 'Missing required fields.' });
        }

        if (!ALLOWED_AUDIENCES.includes(targetAudience)) {
            return res.status(400).json({
                success: false,
                message: `targetAudience must be one of: ${ALLOWED_AUDIENCES.join(', ')}`,
            });
        }

        const channelList = Array.isArray(channels) ? channels : [];
        const validChannels = channelList.filter((c) => ALLOWED_CHANNELS.includes(c));
        if (validChannels.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Select at least one delivery channel (dashboard and/or email).',
            });
        }

        const where = { isActive: true };
        if (targetAudience === 'OWNERS') where.role = 'OWNER';
        else if (targetAudience === 'END_USERS') where.role = 'END_USER';
        else where.role = { not: 'ADMIN' };

        const users = await prisma.user.findMany({
            where,
            select: { id: true, email: true, role: true },
        });

        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'No users found for this audience.' });
        }

        const isDashboard = validChannels.includes('dashboard');
        const isEmail = validChannels.includes('email');
        let dashboardCount = 0;
        let emailOk = 0;
        let emailFailed = 0;

        // Create Dashboard Notifications (skip END_USERs — no owner dashboard)
        if (isDashboard) {
            const dashboardUsers =
                targetAudience === 'END_USERS'
                    ? []
                    : users.filter((u) => u.role !== 'END_USER');

            if (dashboardUsers.length > 0) {
                const notificationsData = dashboardUsers.map((u) => ({
                    userId: u.id,
                    type: 'SYSTEM_ALERT',
                    title: String(subject).trim(),
                    body: String(message).trim(),
                    isRead: false,
                }));
                await prisma.notification.createMany({ data: notificationsData });
                dashboardCount = dashboardUsers.length;
            }
        }

        // Send emails and report delivery outcome (awaited, not fire-and-forget)
        if (isEmail) {
            const emails = users.map((u) => u.email).filter(Boolean);
            const BATCH_SIZE = 50;
            for (let i = 0; i < emails.length; i += BATCH_SIZE) {
                const batch = emails.slice(i, i + BATCH_SIZE);
                try {
                    await sendBroadcastEmail(batch, String(subject).trim(), String(message).trim());
                    emailOk += batch.length;
                } catch (e) {
                    console.error('Batch email error:', e);
                    emailFailed += batch.length;
                }
            }
        }

        const parts = [];
        if (isDashboard) parts.push(`${dashboardCount} in-app`);
        if (isEmail) {
            parts.push(
                emailFailed > 0
                    ? `${emailOk} email sent (${emailFailed} failed)`
                    : `${emailOk} email sent`,
            );
        }

        res.json({
            success: emailFailed === 0 || dashboardCount > 0 || emailOk > 0,
            message: `Broadcast queued for ${users.length} users (${parts.join(', ')}).`,
            data: { audienceSize: users.length, dashboardCount, emailOk, emailFailed },
        });
    } catch (error) {
        console.error('Broadcast error:', error);
        res.status(500).json({ success: false, message: 'Failed to send broadcast.' });
    }
};

module.exports = {
    getNotifications,
    getUnreadCount,
    markAllRead,
    markRead,
    broadcastNotification,
};
