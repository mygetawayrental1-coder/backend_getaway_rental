const {
    getUserFromBearerToken,
    getUserFromBearerTokenOptional,
} = require('../services/authResolve.service');

const attachUser = (req, user) => {
    req.user = user;
    req.currentUser = user;
};

/** Required auth — verifies Clerk JWT and loads the Prisma user by clerkId. */
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

/** Optional auth — attaches user when a valid Clerk token is present. */
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

const requireAuth = authenticate;
const withAuth = optionalAuth;

module.exports = {
    authenticate,
    optionalAuth,
    requireAuth,
    withAuth,
};
