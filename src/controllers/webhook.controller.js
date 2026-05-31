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

module.exports = {
    handleClerk,
};
