const prisma = require('../config/database');
const { getPagination, formatPaginatedResponse } = require('../utils/helpers');
const { formatNotification, parseUnreadOnly } = require('../services/notification.service');

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

module.exports = {
    getNotifications,
    getUnreadCount,
    markAllRead,
    markRead,
};
