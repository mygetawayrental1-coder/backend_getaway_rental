const { Webhook } = require('svix');
const prisma = require('../config/database');

function primaryEmail(data) {
    if (!data?.email_addresses?.length) return null;
    const primaryId = data.primary_email_address_id;
    if (primaryId) {
        const match = data.email_addresses.find((e) => e.id === primaryId);
        if (match?.email_address) return match.email_address;
    }
    return data.email_addresses[0].email_address;
}

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
        if (type === 'user.created') {
            const email = primaryEmail(data);
            if (!email) {
                console.warn('[webhook] user.created without email', data?.id);
                return res.json({ received: true });
            }

            await prisma.user.upsert({
                where: { email },
                update: {
                    clerkId: data.id,
                    firstName: data.first_name || '',
                    lastName: data.last_name || '',
                    profilePic: data.image_url || undefined,
                    emailVerified: true,
                },
                create: {
                    clerkId: data.id,
                    email,
                    firstName: data.first_name || '',
                    lastName: data.last_name || '',
                    profilePic: data.image_url || null,
                    password: '',
                    role: 'END_USER',
                    emailVerified: true,
                },
            });
        }

        if (type === 'user.updated') {
            const email = primaryEmail(data);
            await prisma.user.updateMany({
                where: { clerkId: data.id },
                data: {
                    firstName: data.first_name || '',
                    lastName: data.last_name || '',
                    profilePic: data.image_url || undefined,
                    ...(email ? { email } : {}),
                },
            });
        }

        if (type === 'user.deleted') {
            await prisma.user.updateMany({
                where: { clerkId: data.id },
                data: { clerkId: null },
            });
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
