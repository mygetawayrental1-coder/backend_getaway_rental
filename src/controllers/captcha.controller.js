const { v4: uuidv4 } = require('uuid');

// In-memory store for captchas (in production, use Redis or similar)
const captchaStore = new Map();

// Helper to generate a simple SVG captcha
const generateSVG = (text) => {
    const width = 150;
    const height = 50;
    const fontSize = 30;

    // Simple SVG with some noise
    let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<rect width="100%" height="100%" fill="#f0f0f0"/>`;

    // Add some random lines for noise
    for (let i = 0; i < 5; i++) {
        const x1 = Math.random() * width;
        const y1 = Math.random() * height;
        const x2 = Math.random() * width;
        const y2 = Math.random() * height;
        svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ccc" stroke-width="1"/>`;
    }

    // Add the text
    svg += `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="#333" transform="rotate(${Math.random() * 10 - 5}, ${width / 2}, ${height / 2})">${text}</text>`;
    svg += `</svg>`;

    return Buffer.from(svg).toString('base64');
};

const createCaptcha = async (req, res) => {
    try {
        // Unambiguous characters for mobile readability
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        const id = uuidv4();

        captchaStore.set(id, {
            text: code,
            expires: Date.now() + 5 * 60 * 1000 // 5 minutes
        });

        const imageBase64 = `data:image/svg+xml;base64,${generateSVG(code)}`;

        res.json({
            success: true,
            id,
            imageBase64
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
            captchaStore.delete(captchaId);
        }
        return createCaptcha(req, res);
    } catch (error) {
        console.error('Regenerate captcha error:', error);
        res.status(500).json({ success: false, message: 'Failed to regenerate captcha.' });
    }
};

const verifyCaptcha = (captchaId, answer, consume = true) => {
    if (!captchaId || !answer) return false;

    const stored = captchaStore.get(captchaId);
    if (!stored) return false;

    if (Date.now() > stored.expires) {
        captchaStore.delete(captchaId);
        return false;
    }

    if (stored.text.toUpperCase() === answer.toUpperCase()) {
        if (consume) {
            captchaStore.delete(captchaId); // valid once
        }
        return true;
    }

    return false;
};

const validateCaptcha = async (req, res) => {
    try {
        const { captchaId, answer } = req.body;
        // Don't consume on the pure validation route so features 
        // like Flutter checking it before submit don't break the final API call!
        const isValid = verifyCaptcha(captchaId, answer, false);

        if (isValid) {
            return res.json({ success: true, valid: true });
        } else {
            return res.json({ success: false, valid: false, message: 'Incorrect, expired or missing captcha.' });
        }
    } catch (error) {
        console.error('Validate captcha error:', error);
        res.status(500).json({ success: false, message: 'Validation failed.', valid: false });
    }
};

module.exports = {
    createCaptcha,
    regenerateCaptcha,
    validateCaptcha,
    verifyCaptcha
};
