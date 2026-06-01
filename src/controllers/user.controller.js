const bcrypt = require('bcryptjs');
const prisma = require('../config/database');
const { getPagination, formatPaginatedResponse } = require('../utils/helpers');

// Get all users (Admin only)
const getAllUsers = async (req, res) => {
    try {
        const { page, limit, role, search } = req.query;
        const pagination = getPagination(page, limit);

        const where = {};
        if (role) where.role = role;
        if (search) {
            where.OR = [
                { email: { contains: search } },
                { firstName: { contains: search } },
                { lastName: { contains: search } },
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
                    emailVerified: true,
                    createdAt: true,
                    _count: {
                        select: { properties: true, inquiries: true },
                    },
                },
            }),
            prisma.user.count({ where }),
        ]);

        res.json({
            success: true,
            ...formatPaginatedResponse(users, total, pagination.page, pagination.limit),
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
                emailVerified: true,
                createdAt: true,
                _count: {
                    select: { properties: true, inquiries: true, subscriptions: true },
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
        const { firstName, lastName, countryCode, phoneNumber, address, profilePic, password } = req.body;

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

        // Update password if provided
        if (password) {
            updateData.password = await bcrypt.hash(password, 12);
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
                emailVerified: true,
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

        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found.',
            });
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
        const { page, limit, search } = req.query;
        const pagination = getPagination(page, limit);

        const where = { role: { not: 'ADMIN' } };
        if (search) {
            where.AND = [
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
                        select: { properties: true },
                    },
                    subscriptions: {
                        where: {
                            status: 'ACTIVE',
                            endDate: { gt: new Date() },
                        },
                        take: 1,
                        orderBy: { endDate: 'desc' },
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
                role: rest.role === 'END_USER' ? 'OWNER' : rest.role,
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
            where: { id, role: 'OWNER' },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                countryCode: true,
                phoneNumber: true,
                address: true,
                profilePic: true,
                createdAt: true,
                properties: {
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        propertyId: true,
                        propertyName: true,
                        location: true,
                        status: true,
                        nightlyRate: true,
                        createdAt: true,
                        _count: {
                            select: { inquiries: true },
                        },
                    },
                },
                _count: {
                    select: { properties: true },
                },
            },
        });

        if (!owner) {
            return res.status(404).json({
                success: false,
                message: 'Owner not found.',
            });
        }

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
                ...owner,
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
