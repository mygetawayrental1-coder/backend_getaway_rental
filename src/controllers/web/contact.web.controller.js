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

exports.listMessages = async (req, res) => {
    try {
        const messages = await prisma.webContactMessage.findMany({
            orderBy: { createdAt: 'desc' },
        });

        res.json({ success: true, messages });
    } catch (error) {
        console.error('[web/contact] list', error);
        res.status(500).json({ success: false, message: 'Failed to fetch messages.' });
    }
};

exports.toggleRead = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await prisma.webContactMessage.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Message not found.' });
        }

        const nextRead = !existing.isRead;
        const message = await prisma.webContactMessage.update({
            where: { id },
            data: {
                isRead: nextRead,
                readAt: nextRead ? new Date() : null,
            },
        });

        res.json({ success: true, message });
    } catch (error) {
        console.error('[web/contact] toggle read', error);
        res.status(500).json({ success: false, message: 'Failed to update message.' });
    }
};
