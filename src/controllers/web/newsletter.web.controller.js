const prisma = require('../../config/database');
const { verifyCaptcha } = require('../captcha.controller');

exports.subscribe = async (req, res) => {
    try {
        const { email, captchaId, captchaCode } = req.body;

        if (!(await verifyCaptcha(captchaId, captchaCode))) {
            return res.status(400).json({ success: false, message: 'Invalid or expired security code.' });
        }

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
