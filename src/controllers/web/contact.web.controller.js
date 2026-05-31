const prisma = require('../../config/database');

exports.submit = async (req, res) => {
    try {
        const { name, email, phone, subject, message } = req.body;

        if (!name || !email || !subject || !message) {
            return res.status(400).json({
                success: false,
                message: 'Name, email, subject, and message are required.',
            });
        }

        const row = await prisma.webContactMessage.create({
            data: {
                name: String(name).trim(),
                email: String(email).trim(),
                phone: phone ? String(phone).trim() : null,
                subject: String(subject).trim(),
                message: String(message).trim(),
            },
        });

        res.status(201).json({ success: true, id: row.id });
    } catch (error) {
        console.error('[web/contact]', error);
        res.status(500).json({ success: false, message: 'Failed to send message.' });
    }
};
