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
        let user;
        try {
            user = await getUserFromBearerToken(token);
        } catch (err) {
            if (err?.code === 'ACCOUNT_SUSPENDED') {
                return res.status(403).json({
                    success: false,
                    code: 'ACCOUNT_SUSPENDED',
                    message:
                        'Your account has been suspended. Please contact support to restore access.',
                });
            }
            throw err;
        }

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
        try {
            const user = await getUserFromBearerTokenOptional(token);
            if (user) attachUser(req, user);
        } catch (err) {
            // Suspended users stay unauthenticated for optional routes.
            if (err?.code !== 'ACCOUNT_SUSPENDED') throw err;
        }

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
