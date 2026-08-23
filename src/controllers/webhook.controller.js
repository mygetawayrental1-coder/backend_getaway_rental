const { Webhook } = require('svix');
const { syncUser, deactivateUserByClerkId } = require('./auth.controller');

async function handleClerk(req, res) {
    const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
    if (!webhookSecret) {
        console.warn('[webhook] CLERK_WEBHOOK_SECRET is not set');
        return res.status(503).json({ error: 'Webhook not configured' });
    }

    const headers = {
        'svix-id': req.headers['svix-id'],
        'svix-timestamp': req.headers['svix-timestamp'],
        'svix-signature': req.headers['svix-signature'],
    };

    let event;
    try {
        const wh = new Webhook(webhookSecret);
        event = wh.verify(req.body, headers);
    } catch (e) {
        console.warn('[webhook] Invalid signature', e.message);
        return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const { type, data } = event;

    try {
        if (type === 'user.created' || type === 'user.updated') {
            await syncUser(data);
        }

        if (type === 'user.deleted') {
            await deactivateUserByClerkId(data.id);
        }
    } catch (err) {
        console.error('[webhook] handler error', err);
        return res.status(500).json({ error: 'Webhook processing failed' });
    }

    return res.json({ received: true });
}

async function handlePayPal(req, res) {
    try {
        const event = req.body || {};
        const type = event.event_type || event.eventType;
        const resource = event.resource || {};
        const relatedOrder = resource.supplementary_data?.related_ids?.order_id;
        const resolvedId =
            relatedOrder ||
            (type && String(type).includes('CHECKOUT.ORDER') ? resource.id : null);
        if (!resolvedId) {
            return res.json({ received: true, ignored: true });
        }

        const { finalizePayPalOrder } = require('./payment.controller');
        await finalizePayPalOrder(resolvedId);
        return res.json({ received: true });
    } catch (err) {
        console.error('[webhook] PayPal handler error', err.message);
        return res.status(500).json({ error: 'PayPal webhook processing failed' });
    }
}

module.exports = {
    handleClerk,
    handlePayPal,
};
