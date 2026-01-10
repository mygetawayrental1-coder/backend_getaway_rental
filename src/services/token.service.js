const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

// Generate JWT token
const generateToken = (payload, expiresIn = process.env.JWT_EXPIRES_IN || '7d') => {
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};

// Verify JWT token
const verifyToken = (token) => {
    try {
        return jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        return null;
    }
};

// Generate random token for email verification / password reset
const generateRandomToken = () => {
    return uuidv4();
};

// Generate reset token with expiry (1 hour)
const generateResetToken = () => {
    return {
        token: generateRandomToken(),
        expiry: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    };
};

module.exports = {
    generateToken,
    verifyToken,
    generateRandomToken,
    generateResetToken,
};
