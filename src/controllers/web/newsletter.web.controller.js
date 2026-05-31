const prisma = require('../../config/database');

exports.subscribe = async (req, res) => {
    try {
        const { email } = req.body;
        const normalized = String(email || '')
            .trim()
            .toLowerCase();
        if (!normalized || !normalized.includes('@')) {
            return res.status(400).json({ success: false, message: 'Valid email is required.' });
        }

        await prisma.newsletterSubscriber.upsert({
            where: { email: normalized },
            update: {},
            create: { email: normalized },
        });

        res.status(201).json({ success: true, message: 'Subscribed.' });
    } catch (error) {
        console.error('[web/newsletter]', error);
        res.status(500).json({ success: false, message: 'Subscription failed.' });
    }
};
