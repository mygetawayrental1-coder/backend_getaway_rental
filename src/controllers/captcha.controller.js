const { v4: uuidv4 } = require('uuid');
const prisma = require('../config/database');

// Helper to generate a simple SVG captcha
const generateSVG = (text) => {
    const width = 150;
    const height = 50;
    const fontSize = 30;

    let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<rect width="100%" height="100%" fill="#f0f0f0"/>`;

    for (let i = 0; i < 5; i++) {
        const x1 = Math.random() * width;
        const y1 = Math.random() * height;
        const x2 = Math.random() * width;
        const y2 = Math.random() * height;
        svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ccc" stroke-width="1"/>`;
    }

    svg += `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="#333" transform="rotate(${Math.random() * 10 - 5}, ${width / 2}, ${height / 2})">${text}</text>`;
    svg += `</svg>`;

    return Buffer.from(svg).toString('base64');
};

async function pruneExpiredCaptchas() {
    try {
        await prisma.captchaChallenge.deleteMany({
            where: { expiresAt: { lt: new Date() } },
        });
    } catch (_) {
        /* table may not exist until migrate */
    }
}

const createCaptcha = async (req, res) => {
    try {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        const id = uuidv4();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        await prisma.captchaChallenge.create({
            data: { id, code, expiresAt },
        });

        // Opportunistic cleanup (best-effort)
        pruneExpiredCaptchas();

        const imageBase64 = `data:image/svg+xml;base64,${generateSVG(code)}`;

        res.json({
            success: true,
            id,
            imageBase64,
        });
    } catch (error) {
        console.error('Create captcha error:', error);
        res.status(500).json({ success: false, message: 'Failed to create captcha.' });
    }
};

const regenerateCaptcha = async (req, res) => {
    try {
        const { captchaId } = req.body;
        if (captchaId) {
            await prisma.captchaChallenge.deleteMany({ where: { id: captchaId } });
        }
        return createCaptcha(req, res);
    } catch (error) {
        console.error('Regenerate captcha error:', error);
        res.status(500).json({ success: false, message: 'Failed to regenerate captcha.' });
    }
};

const verifyCaptcha = async (captchaId, answer, consume = true) => {
    if (!captchaId || !answer) return false;

    try {
        const stored = await prisma.captchaChallenge.findUnique({
            where: { id: captchaId },
        });
        if (!stored) return false;

        if (Date.now() > new Date(stored.expiresAt).getTime()) {
            await prisma.captchaChallenge.deleteMany({ where: { id: captchaId } });
            return false;
        }

        const ok = stored.code.toLowerCase() === String(answer).trim().toLowerCase();
        if (ok && consume) {
            await prisma.captchaChallenge.deleteMany({ where: { id: captchaId } });
        }
        return ok;
    } catch (error) {
        console.error('Verify captcha error:', error);
        return false;
    }
};

/** HTTP: POST /captcha/validate — used by Flutter; does not consume (submit endpoints verify again). */
const validateCaptcha = async (req, res) => {
    try {
        const captchaId = req.body?.captchaId;
        const answer = req.body?.answer ?? req.body?.captchaCode;
        const valid = await verifyCaptcha(captchaId, answer, false);
        if (!valid) {
            return res.status(400).json({
                success: false,
                valid: false,
                message: 'Invalid or expired captcha.',
            });
        }
        return res.json({ success: true, valid: true });
    } catch (error) {
        console.error('Validate captcha error:', error);
        return res.status(500).json({
            success: false,
            valid: false,
            message: 'Failed to validate captcha.',
        });
    }
};

module.exports = {
    createCaptcha,
    regenerateCaptcha,
    validateCaptcha,
    verifyCaptcha,
};
