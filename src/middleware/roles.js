// Role constants
const ROLES = {
    ADMIN: 'ADMIN',
    OWNER: 'OWNER',
    END_USER: 'END_USER',
};

// Check if user has required role(s)
const requireRole = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required.',
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Insufficient permissions.',
            });
        }

        next();
    };
};

// Admin only middleware
const isAdmin = requireRole(ROLES.ADMIN);
const requireAdmin = isAdmin;

// Owner only middleware
const isOwner = requireRole(ROLES.OWNER);
const requireOwner = isOwner;

// Admin or Owner middleware
const isAdminOrOwner = requireRole(ROLES.ADMIN, ROLES.OWNER);

// Any authenticated user
const isAuthenticated = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required.',
        });
    }
    next();
};

// Check if user is resource owner or admin
const isResourceOwnerOrAdmin = (resourceUserIdField = 'ownerId') => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required.',
            });
        }

        // Admins can access all resources
        if (req.user.role === ROLES.ADMIN) {
            return next();
        }

        // Resource ownership will be checked in controller
        req.checkOwnership = true;
        req.ownershipField = resourceUserIdField;
        next();
    };
};

module.exports = {
    ROLES,
    requireRole,
    isAdmin,
    requireAdmin,
    isOwner,
    requireOwner,
    isAdminOrOwner,
    isAuthenticated,
    isResourceOwnerOrAdmin,
};
