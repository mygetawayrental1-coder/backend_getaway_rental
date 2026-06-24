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
const broadcastNotification = async (req, res) => {
    try {
        const { targetAudience, channels, subject, message } = req.body;
        
        if (!targetAudience || !channels || !subject || !message) {
            return res.status(400).json({ success: false, message: 'Missing required fields.' });
        }

        let where = {};
        if (targetAudience === 'OWNERS') where.role = 'OWNER';
        if (targetAudience === 'END_USERS') where.role = 'END_USER';
        // 'ALL' means no role filter, but we typically exclude ADMIN unless 'ALL' explicitly
        if (targetAudience === 'ALL') {
            where.role = { not: 'ADMIN' }; // Don't broadcast to yourself by default
        }

        const users = await prisma.user.findMany({
            where,
            select: { id: true, email: true, role: true }
        });

        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'No users found for this audience.' });
        }

        const isDashboard = channels.includes('dashboard');
        const isEmail = channels.includes('email');

        // Create Dashboard Notifications (skip END_USERs)
        if (isDashboard) {
            const dashboardUsers = targetAudience === 'END_USERS' 
                ? [] 
                : users.filter(u => u.role !== 'END_USER');
                
            if (dashboardUsers.length > 0) {
                const notificationsData = dashboardUsers.map(u => ({
                    userId: u.id,
                    type: 'SYSTEM_ALERT',
                    title: subject,
                    body: message,
                    isRead: false
                }));
                await prisma.notification.createMany({ data: notificationsData });
            }
        }

        // Send Emails in batches of 50
        if (isEmail) {
            const emails = users.map(u => u.email);
            const BATCH_SIZE = 50;
            
            // Fire and forget
            (async () => {
                for (let i = 0; i < emails.length; i += BATCH_SIZE) {
                    const batch = emails.slice(i, i + BATCH_SIZE);
                    try {
                        await sendBroadcastEmail(batch, subject, message);
                    } catch (e) {
                        console.error('Batch email error:', e);
                    }
                }
            })();
        }

        res.json({ success: true, message: `Broadcast successfully sent to ${users.length} users.` });
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
