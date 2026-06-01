const prisma = require('../config/database');
const { stringifyJsonField, parseJsonField, getPagination, formatPaginatedResponse } = require('../utils/helpers');

const NOTIFICATION_TYPES = {
    BOOKING_PENDING: 'booking_pending',
    BOOKING_CONFIRMED: 'booking_confirmed',
    BOOKING_CANCELLED: 'booking_cancelled',
    BOOKING_ONGOING: 'booking_ongoing',
    BOOKING_COMPLETED: 'booking_completed',
    REVIEW_NEW: 'review_new',
    REVIEW_REPLY: 'review_reply',
    PAYOUT_PROCESSED: 'payout_processed',
    PAYOUT_REQUEST_NEW: 'payout_request_new',
    INQUIRY_NEW: 'inquiry_new',
    GUEST_REQUEST_NEW: 'guest_request_new',
    SUBSCRIPTION_EXPIRING: 'subscription_expiring',
    MESSAGE_NEW: 'message_new',
    SUPPORT_TICKET_NEW: 'support_ticket_new',
    SUPPORT_TICKET_REPLY: 'support_ticket_reply',
    SUPPORT_TICKET_STATUS: 'support_ticket_status',
};

/** Human-readable title + body for known notification types. */
function buildNotificationContent(type, vars = {}) {
    const propertyName = vars.propertyName || 'your property';
    const amount = vars.amount != null ? vars.amount : '';

    switch (type) {
        case NOTIFICATION_TYPES.BOOKING_PENDING:
            return {
                title: 'New booking request',
                body: `New booking request for ${propertyName}`,
            };
        case NOTIFICATION_TYPES.BOOKING_CONFIRMED:
            return {
                title: 'Booking confirmed',
                body: `Your booking at ${propertyName} is confirmed`,
            };
        case NOTIFICATION_TYPES.BOOKING_CANCELLED:
            return {
                title: 'Booking cancelled',
                body: `Booking at ${propertyName} was cancelled`,
            };
        case NOTIFICATION_TYPES.BOOKING_ONGOING:
            return {
                title: 'Guest checked in',
                body: `Guest has checked in at ${propertyName}`,
            };
        case NOTIFICATION_TYPES.BOOKING_COMPLETED:
            return {
                title: 'Booking complete',
                body: `Booking at ${propertyName} is complete. Please leave a review.`,
            };
        case NOTIFICATION_TYPES.REVIEW_NEW:
            return {
                title: 'New review',
                body: `New review received for ${propertyName}`,
            };
        case NOTIFICATION_TYPES.REVIEW_REPLY:
            return {
                title: 'Review reply',
                body: vars.propertyName
                    ? `The owner replied to your review for ${vars.propertyName}`
                    : 'The property owner replied to your review',
            };
        case NOTIFICATION_TYPES.PAYOUT_PROCESSED:
            return {
                title: 'Payout processed',
                body: `Your payout of $${amount} has been processed`,
            };
        case NOTIFICATION_TYPES.PAYOUT_REQUEST_NEW:
            return {
                title: 'New payout request',
                body: vars.ownerName
                    ? `${vars.ownerName} requested a payout of $${amount}`
                    : `A payout of $${amount} was requested`,
            };
        case NOTIFICATION_TYPES.INQUIRY_NEW:
            return {
                title: 'New inquiry',
                body: `New inquiry for ${propertyName}`,
            };
        case NOTIFICATION_TYPES.GUEST_REQUEST_NEW:
            return {
                title: 'New rent request',
                body: vars.guestName
                    ? `${vars.guestName} requested to rent ${propertyName}`
                    : `New rent request for ${propertyName}`,
            };
        case NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRING:
            return {
                title: 'Subscription expiring',
                body: 'Your subscription expires in 7 days',
            };
        case NOTIFICATION_TYPES.MESSAGE_NEW:
            return {
                title: 'New message',
                body: vars.senderName
                    ? `New message from ${vars.senderName}`
                    : 'You have a new message',
            };
        case NOTIFICATION_TYPES.SUPPORT_TICKET_NEW:
            return {
                title: 'New support ticket',
                body: vars.subject
                    ? `New ticket: ${vars.subject}`
                    : 'A new support ticket was submitted',
            };
        case NOTIFICATION_TYPES.SUPPORT_TICKET_REPLY:
            return {
                title: 'Support ticket reply',
                body: vars.subject
                    ? `New reply on: ${vars.subject}`
                    : 'You have a new reply on your support ticket',
            };
        case NOTIFICATION_TYPES.SUPPORT_TICKET_STATUS:
            return {
                title: 'Ticket status updated',
                body: vars.status
                    ? `Your ticket was marked ${vars.status}`
                    : 'Your support ticket status was updated',
            };
        default:
            return {
                title: vars.title || 'Notification',
                body: vars.body || '',
            };
    }
}

/**
 * Create a notification for a user.
 * @param {{ userId: string, type: string, title: string, body: string, data?: object }} params
 */
async function createNotification({ userId, type, title, body, data }) {
    if (!userId || !type || !title || !body) {
        throw new Error('userId, type, title, and body are required to create a notification.');
    }

    return prisma.notification.create({
        data: {
            userId,
            type,
            title,
            body,
            data: data != null ? stringifyJsonField(data) : null,
        },
    });
}

/**
 * Convenience wrapper: builds title/body from a known type, then persists.
 * @param {{ userId: string, type: string, data?: object, vars?: object }} params
 */
async function createTypedNotification({ userId, type, data = {}, vars = {} }) {
    const { title, body } = buildNotificationContent(type, { ...data, ...vars });
    return createNotification({ userId, type, title, body, data });
}

function formatNotification(row) {
    if (!row) return null;
    return {
        ...row,
        data: parseJsonField(row.data),
    };
}

function parseUnreadOnly(value) {
    if (value === undefined || value === null || value === '') return false;
    return ['true', '1', 'yes'].includes(String(value).toLowerCase());
}

module.exports = {
    NOTIFICATION_TYPES,
    buildNotificationContent,
    createNotification,
    createTypedNotification,
    formatNotification,
    parseUnreadOnly,
};
