const {
    getUserFromBearerToken,
    getUserFromBearerTokenOptional,
} = require('../services/authResolve.service');

const attachUser = (req, user) => {
    req.user = user;
    req.currentUser = user;
};

// Required auth — legacy JWT or Clerk Bearer token
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'No token provided. Authorization denied.',
            });
        }

        const token = authHeader.split(' ')[1];
        const user = await getUserFromBearerToken(token);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token.',
            });
        }

        attachUser(req, user);
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error during authentication.',
        });
    }
};

// Optional authentication — attaches user when token is valid
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return next();
        }

        const token = authHeader.split(' ')[1];
        const user = await getUserFromBearerTokenOptional(token);
        if (user) attachUser(req, user);

        next();
    } catch (error) {
        next();
    }
};

// Aliases for Clerk-style naming (use existing ../middleware/roles with authenticate)
const requireAuth = authenticate;
const withAuth = optionalAuth;

module.exports = {
    authenticate,
    optionalAuth,
    requireAuth,
    withAuth,
};
