const prisma = require('../config/database');
const { sendInquiryNotification } = require('../services/email.service');
const { calculateNights, getPagination, formatPaginatedResponse } = require('../utils/helpers');

// Create inquiry
const createInquiry = async (req, res) => {
    try {
        const {
            propertyId,
            fullName,
            email,
            phone,
            gender,
            guests,
            message,
            checkin,
            checkout,
        } = req.body;

        // Find property
        const property = await prisma.property.findFirst({
            where: { OR: [{ id: propertyId }, { propertyId }] },
            include: {
                owner: { select: { email: true } },
            },
        });

        if (!property) {
            return res.status(404).json({
                success: false,
                message: 'Property not found.',
            });
        }

        // Calculate nights and total amount
        const nights = calculateNights(checkin, checkout);
        const totalAmount = nights ? nights * property.nightlyRate : null;

        const inquiry = await prisma.inquiry.create({
            data: {
                fullName,
                email,
                phone,
                gender,
                guests: parseInt(guests) || 1,
                message,
                checkin: checkin ? new Date(checkin) : null,
                checkout: checkout ? new Date(checkout) : null,
                nights,
                totalAmount,
                propertyName: property.propertyName,
                propertyImages: property.images,
                propertyId: property.id,
                userId: req.user?.id || null,
            },
            include: {
                property: {
                    select: { id: true, propertyId: true, propertyName: true, location: true },
                },
            },
        });

        // Send notification to owner
        try {
            await sendInquiryNotification(property.owner.email, {
                propertyName: property.propertyName,
                fullName,
                email,
                phone,
                checkin,
                checkout,
                guests,
                message,
            });
        } catch (emailError) {
            console.error('Failed to send inquiry notification:', emailError);
        }

        res.status(201).json({
            success: true,
            message: 'Inquiry submitted successfully.',
            data: inquiry,
        });
    } catch (error) {
        console.error('Create inquiry error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit inquiry.',
            error: error.message,
        });
    }
};

// Get all inquiries (Admin only)
const getAllInquiries = async (req, res) => {
    try {
        const { page, limit, status, search } = req.query;
        const pagination = getPagination(page, limit);

        const where = {};
        if (status) where.status = status;
        if (search) {
            where.OR = [
                { fullName: { contains: search } },
                { email: { contains: search } },
                { propertyName: { contains: search } },
                { enquiryId: { contains: search } },
            ];
        }

        const [inquiries, total] = await Promise.all([
            prisma.inquiry.findMany({
                where,
                skip: pagination.skip,
                take: pagination.take,
                orderBy: { createdAt: 'desc' },
                include: {
                    property: {
                        select: { id: true, propertyId: true, propertyName: true, location: true },
                    },
                },
            }),
            prisma.inquiry.count({ where }),
        ]);

        res.json({
            success: true,
            ...formatPaginatedResponse(inquiries, total, pagination.page, pagination.limit),
        });
    } catch (error) {
        console.error('Get all inquiries error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch inquiries.',
        });
    }
};

// Get inquiries by owner email
const getInquiriesByEmail = async (req, res) => {
    try {
        const { email } = req.params;
        const ownerEmail = email || req.user.email;

        // Check authorization
        if (req.user.role !== 'ADMIN' && req.user.email !== ownerEmail) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.',
            });
        }

        const owner = await prisma.user.findUnique({
            where: { email: ownerEmail },
        });

        if (!owner) {
            return res.status(404).json({
                success: false,
                message: 'Owner not found.',
            });
        }

        // Get all properties owned by user
        const properties = await prisma.property.findMany({
            where: { ownerId: owner.id },
            select: { id: true },
        });

        const propertyIds = properties.map(p => p.id);

        const inquiries = await prisma.inquiry.findMany({
            where: { propertyId: { in: propertyIds } },
            orderBy: { createdAt: 'desc' },
            include: {
                property: {
                    select: { id: true, propertyId: true, propertyName: true, location: true },
                },
            },
        });

        res.json({
            success: true,
            data: inquiries,
        });
    } catch (error) {
        console.error('Get inquiries by email error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch inquiries.',
        });
    }
};

// Get inquiry by ID
const getInquiryById = async (req, res) => {
    try {
        const { id } = req.params;

        const inquiry = await prisma.inquiry.findFirst({
            where: { OR: [{ id }, { enquiryId: id }] },
            include: {
                property: {
                    include: {
                        owner: { select: { id: true, email: true } },
                    },
                },
            },
        });

        if (!inquiry) {
            return res.status(404).json({
                success: false,
                message: 'Inquiry not found.',
            });
        }

        // Check authorization
        if (req.user.role !== 'ADMIN' && inquiry.property.owner.id !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.',
            });
        }

        res.json({
            success: true,
            data: inquiry,
        });
    } catch (error) {
        console.error('Get inquiry by ID error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch inquiry.',
        });
    }
};

// Accept inquiry
const acceptInquiry = async (req, res) => {
    try {
        const { id } = req.params;

        const inquiry = await prisma.inquiry.findFirst({
            where: { OR: [{ id }, { enquiryId: id }] },
            include: {
                property: {
                    include: {
                        owner: { select: { id: true } },
                    },
                },
            },
        });

        if (!inquiry) {
            return res.status(404).json({
                success: false,
                message: 'Inquiry not found.',
            });
        }

        // Check authorization
        if (req.user.role !== 'ADMIN' && inquiry.property.owner.id !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.',
            });
        }

        const updated = await prisma.inquiry.update({
            where: { id: inquiry.id },
            data: { status: 'ACCEPTED' },
        });

        res.json({
            success: true,
            message: 'Inquiry accepted.',
            data: updated,
        });
    } catch (error) {
        console.error('Accept inquiry error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to accept inquiry.',
        });
    }
};

// Reject inquiry
const rejectInquiry = async (req, res) => {
    try {
        const { id } = req.params;

        const inquiry = await prisma.inquiry.findFirst({
            where: { OR: [{ id }, { enquiryId: id }] },
            include: {
                property: {
                    include: {
                        owner: { select: { id: true } },
                    },
                },
            },
        });

        if (!inquiry) {
            return res.status(404).json({
                success: false,
                message: 'Inquiry not found.',
            });
        }

        // Check authorization
        if (req.user.role !== 'ADMIN' && inquiry.property.owner.id !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.',
            });
        }

        const updated = await prisma.inquiry.update({
            where: { id: inquiry.id },
            data: { status: 'REJECTED' },
        });

        res.json({
            success: true,
            message: 'Inquiry rejected.',
            data: updated,
        });
    } catch (error) {
        console.error('Reject inquiry error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reject inquiry.',
        });
    }
};

// Delete inquiry
const deleteInquiry = async (req, res) => {
    try {
        const { id } = req.params;

        const inquiry = await prisma.inquiry.findFirst({
            where: { OR: [{ id }, { enquiryId: id }] },
        });

        if (!inquiry) {
            return res.status(404).json({
                success: false,
                message: 'Inquiry not found.',
            });
        }

        await prisma.inquiry.delete({ where: { id: inquiry.id } });

        res.json({
            success: true,
            message: 'Inquiry deleted.',
        });
    } catch (error) {
        console.error('Delete inquiry error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete inquiry.',
        });
    }
};

module.exports = {
    createInquiry,
    getAllInquiries,
    getInquiriesByEmail,
    getInquiryById,
    acceptInquiry,
    rejectInquiry,
    deleteInquiry,
};
