const prisma = require('../config/database');
const { getPagination, formatPaginatedResponse } = require('../utils/helpers');
const { reconcileAllNonAdminRoles } = require('../services/subscriptionAccess.service');

const ALLOWED_ROLES = ['ADMIN', 'OWNER', 'END_USER'];

// Get all users (Admin only)
const getAllUsers = async (req, res) => {
    try {
        const { page, limit, role, search, isActive, subscribed } = req.query;
        const pagination = getPagination(page, limit);

        // Keep RBAC labels accurate: no plan → USER, active plan → OWNER.
        try {
            await reconcileAllNonAdminRoles();
        } catch (reconcileErr) {
            console.warn('[users] role reconcile failed:', reconcileErr.message);
        }

        const where = {};
        if (role) where.role = role;
        if (isActive === 'true' || isActive === '1') where.isActive = true;
        if (isActive === 'false' || isActive === '0') where.isActive = false;
        if (subscribed === 'true' || subscribed === '1') {
            where.subscriptions = { some: { status: 'ACTIVE' } };
        }
        if (subscribed === 'false' || subscribed === '0' || subscribed === 'none') {
            where.NOT = {
                subscriptions: { some: { status: 'ACTIVE' } },
            };
        }
        if (search) {
            where.OR = [
                { email: { contains: search, mode: 'insensitive' } },
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
            ];
        }

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                skip: pagination.skip,
                take: pagination.take,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    countryCode: true,
                    phoneNumber: true,
                    address: true,
                    profilePic: true,
                    role: true,
                    isActive: true,
                    createdAt: true,
                    _count: {
                        select: { ownedProperties: true, inquiries: true },
                    },
                    subscriptions: {
                        where: {
                            status: 'ACTIVE',
                        },
                        take: 1,
                        orderBy: { createdAt: 'desc' },
                        include: {
                            plan: { select: { id: true, name: true, maxProperties: true } },
                        },
                    },
                },
            }),
            prisma.user.count({ where }),
        ]);

        const formattedUsers = users.map((u) => {
            const activeSub = u.subscriptions?.[0] || null;
            const { subscriptions, ...rest } = u;
            return {
                ...rest,
                subscription: activeSub
                    ? {
                          planName: activeSub.plan.name,
                          maxProperties: activeSub.plan.maxProperties,
                          endDate: activeSub.endDate,
                      }
                    : null,
            };
        });

        res.json({
            success: true,
            ...formatPaginatedResponse(formattedUsers, total, pagination.page, pagination.limit),
        });
    } catch (error) {
        console.error('Get all users error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch users.',
        });
    }
};

// Get user by ID
const getUserById = async (req, res) => {
    try {
        const { id } = req.params;

        // Check authorization
        if (req.user.role !== 'ADMIN' && req.user.id !== id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.',
            });
        }

        const user = await prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                countryCode: true,
                phoneNumber: true,
                address: true,
                profilePic: true,
                role: true,
                createdAt: true,
                _count: {
                    select: { ownedProperties: true, inquiries: true, subscriptions: true },
                },
            },
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found.',
            });
        }

        res.json({
            success: true,
            data: user,
        });
    } catch (error) {
        console.error('Get user by ID error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user.',
        });
    }
};

// Update user profile
const updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { firstName, lastName, countryCode, phoneNumber, address, profilePic, password, paymentInstructions, role, isActive } = req.body;

        // Check authorization
        if (req.user.role !== 'ADMIN' && req.user.id !== id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.',
            });
        }

        const updateData = {};
        if (firstName) updateData.firstName = firstName;
        if (lastName) updateData.lastName = lastName;
        if (countryCode !== undefined) updateData.countryCode = countryCode;
        if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
        if (address !== undefined) updateData.address = address;
        if (profilePic !== undefined) updateData.profilePic = profilePic;
        if (paymentInstructions !== undefined) updateData.paymentInstructions = paymentInstructions;

        if (req.user.role === 'ADMIN') {
            if (isActive !== undefined) updateData.isActive = isActive;

            if (role !== undefined && role !== null && role !== '') {
                if (!ALLOWED_ROLES.includes(role)) {
                    return res.status(400).json({
                        success: false,
                        message: `role must be one of: ${ALLOWED_ROLES.join(', ')}`,
                    });
                }

                const target = await prisma.user.findUnique({ where: { id } });
                if (!target) {
                    return res.status(404).json({
                        success: false,
                        message: 'User not found.',
                    });
                }

                if (target.role === 'ADMIN' && role !== 'ADMIN') {
                    const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
                    if (adminCount <= 1) {
                        return res.status(400).json({
                            success: false,
                            message: 'Cannot demote the last administrator.',
                        });
                    }
                }

                if (role === 'OWNER') {
                    const activeSub = await prisma.userSubscription.findFirst({
                        where: { userId: id, status: 'ACTIVE' },
                    });
                    if (!activeSub) {
                        return res.status(400).json({
                            success: false,
                            message:
                                'Assign a subscription before setting role to OWNER. Owner status follows an active plan.',
                        });
                    }
                }

                if (role === 'END_USER') {
                    // Cancel plans so role reconcile does not immediately re-promote to OWNER.
                    await prisma.userSubscription.updateMany({
                        where: { userId: id, status: { in: ['ACTIVE', 'PENDING'] } },
                        data: { status: 'CANCELLED' },
                    });
                }

                updateData.role = role;
            }
        }

        // Password is managed by Clerk — ignore if clients still send it.
        if (password) {
            console.warn('updateUser ignored password field (Clerk auth).');
        }

        const user = await prisma.user.update({
            where: { id },
            data: updateData,
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                countryCode: true,
                phoneNumber: true,
                address: true,
                profilePic: true,
                role: true,
                isActive: true,
                paymentInstructions: true,
            },
        });

        res.json({
            success: true,
            message: 'Profile updated successfully.',
            data: user,
        });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update profile.',
        });
    }
};

// Delete user (Admin only)
const deleteUser = async (req, res) => {
    try {
        const { id } = req.params;

        if (req.user.id === id) {
            return res.status(400).json({
                success: false,
                message: 'You cannot delete your own account.',
            });
        }

        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found.',
            });
        }

        if (user.role === 'ADMIN') {
            const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
            if (adminCount <= 1) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot delete the last administrator.',
                });
            }
        }

        await prisma.user.delete({ where: { id } });

        res.json({
            success: true,
            message: 'User deleted successfully.',
        });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete user.',
        });
    }
};

// Get all owners
const getAllOwners = async (req, res) => {
    try {
        const { page, limit, search, subscribed } = req.query;
        const pagination = getPagination(page, limit, { maxLimit: 2000 });
        const now = new Date();
        const subscribedOnly = subscribed === 'true' || subscribed === '1';

        // Owners list = OWNER role (active plan). Use subscribed=true for plan filter too.
        const where = { role: 'OWNER' };
        if (subscribedOnly) {
            where.subscriptions = {
                some: {
                    status: 'ACTIVE',
                },
            };
        }
        if (search) {
            where.AND = [
                ...(where.AND || []),
                {
                    OR: [
                        { email: { contains: search, mode: 'insensitive' } },
                        { firstName: { contains: search, mode: 'insensitive' } },
                        { lastName: { contains: search, mode: 'insensitive' } },
                    ],
                },
            ];
        }

        const [owners, total] = await Promise.all([
            prisma.user.findMany({
                where,
                skip: pagination.skip,
                take: pagination.take,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    countryCode: true,
                    phoneNumber: true,
                    address: true,
                    profilePic: true,
                    role: true,
                    createdAt: true,
                    _count: {
                        select: { ownedProperties: true },
                    },
                    subscriptions: {
                        where: {
                            status: 'ACTIVE',
                        },
                        take: 1,
                        orderBy: { createdAt: 'desc' },
                        include: {
                            plan: { select: { id: true, name: true, maxProperties: true } },
                        },
                    },
                },
            }),
            prisma.user.count({ where }),
        ]);

        const data = owners.map((o) => {
            const activeSub = o.subscriptions?.[0] || null;
            const { subscriptions, ...rest } = o;
            return {
                ...rest,
                role: rest.role,
                subscription: activeSub
                    ? {
                          planName: activeSub.plan.name,
                          maxProperties: activeSub.plan.maxProperties,
                          endDate: activeSub.endDate,
                      }
                    : null,
                canListProperties: Boolean(activeSub),
            };
        });

        res.json({
            success: true,
            ...formatPaginatedResponse(data, total, pagination.page, pagination.limit),
        });
    } catch (error) {
        console.error('Get all owners error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch owners.',
        });
    }
};

// Get owner by ID with properties
const getOwnerById = async (req, res) => {
    try {
        const { id } = req.params;

        const owner = await prisma.user.findFirst({
            where: {
                id,
                role: { in: ['OWNER', 'END_USER'] },
            },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                countryCode: true,
                phoneNumber: true,
                address: true,
                profilePic: true,
                role: true,
                isActive: true,
                createdAt: true,
                ownedProperties: {
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        propertyId: true,
                        propertyName: true,
                        location: true,
                        state: true,
                        status: true,
                        nightlyRate: true,
                        bedrooms: true,
                        bathrooms: true,
                        createdAt: true,
                        _count: {
                            select: { inquiries: true },
                        },
                    },
                },
                subscriptions: {
                    where: {
                        status: { in: ['ACTIVE', 'Active'] },
                    },
                    take: 1,
                    orderBy: { createdAt: 'desc' },
                    include: {
                        plan: {
                            select: {
                                id: true,
                                name: true,
                                maxProperties: true,
                                duration: true,
                            },
                        },
                    },
                },
                _count: {
                    select: { ownedProperties: true },
                },
            },
        });

        if (!owner) {
            return res.status(404).json({
                success: false,
                message: 'Owner not found.',
            });
        }

        const activeSub = owner.subscriptions?.[0] || null;
        const { subscriptions, ownedProperties, ...rest } = owner;

        const bookingRevenueAgg = await prisma.booking.aggregate({
            where: {
                status: 'CONFIRMED',
                property: { ownerId: id },
            },
            _sum: { totalAmount: true },
        });

        res.json({
            success: true,
            data: {
                ...rest,
                role: rest.role,
                fullName: [rest.firstName, rest.lastName].filter(Boolean).join(' ').trim() || rest.email,
                phone: rest.phoneNumber
                    ? `${rest.countryCode ? `${rest.countryCode} ` : ''}${rest.phoneNumber}`.trim()
                    : null,
                properties: ownedProperties,
                propertyCount: ownedProperties.length,
                ownedProperties,
                subscription: activeSub
                    ? {
                          id: activeSub.id,
                          status: activeSub.status,
                          startDate: activeSub.startDate,
                          endDate: activeSub.endDate,
                          planName: activeSub.plan?.name || null,
                          maxProperties: activeSub.plan?.maxProperties ?? null,
                          duration: activeSub.plan?.duration || null,
                      }
                    : null,
                bookingRevenue: bookingRevenueAgg._sum.totalAmount || 0,
            },
        });
    } catch (error) {
        console.error('Get owner by ID error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch owner.',
        });
    }
};

module.exports = {
    getAllUsers,
    getUserById,
    updateUser,
    deleteUser,
    getAllOwners,
    getOwnerById,
};
