const prisma = require('../config/database');

const CALC_TYPES = ['percent', 'flat'];

function validateName(name) {
    return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(name);
}

function slugifyLabel(label) {
    return String(label || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_')
        .slice(0, 60);
}

function parseValue(raw, calcType) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
        return { error: 'Value must be a number greater than 0.' };
    }
    if (calcType === 'percent' && n > 100) {
        return { error: 'Percent value cannot exceed 100.' };
    }
    return { value: n };
}

/**
 * GET /booking-charges
 * Public: active charges for guest booking quotes
 */
const listActive = async (req, res) => {
    try {
        const charges = await prisma.bookingCharge.findMany({
            where: { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        });
        res.json({ success: true, data: charges });
    } catch (error) {
        console.error('List booking charges error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch booking charges.' });
    }
};

/**
 * GET /booking-charges/admin
 * Admin: all charges
 */
const listAdmin = async (req, res) => {
    try {
        const charges = await prisma.bookingCharge.findMany({
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        });
        res.json({ success: true, data: charges });
    } catch (error) {
        console.error('Admin list booking charges error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch booking charges.' });
    }
};

/**
 * POST /booking-charges
 * Admin: create
 */
const create = async (req, res) => {
    try {
        const { name, label, calcType, value, isActive, sortOrder } = req.body;

        if (!label || !String(label).trim()) {
            return res.status(400).json({ success: false, message: 'Label is required.' });
        }

        const type = String(calcType || '').toLowerCase();
        if (!CALC_TYPES.includes(type)) {
            return res.status(400).json({
                success: false,
                message: 'calcType must be "percent" or "flat".',
            });
        }

        const machineName = String(name || '').trim() || slugifyLabel(label);
        if (!validateName(machineName)) {
            return res.status(400).json({
                success: false,
                message:
                    'Charge key must start with a letter and contain only letters, numbers, and underscores.',
            });
        }

        const parsed = parseValue(value, type);
        if (parsed.error) {
            return res.status(400).json({ success: false, message: parsed.error });
        }

        const charge = await prisma.bookingCharge.create({
            data: {
                name: machineName,
                label: String(label).trim(),
                calcType: type,
                value: parsed.value,
                isActive: isActive !== false,
                sortOrder: sortOrder != null ? parseInt(sortOrder, 10) || 0 : 0,
            },
        });

        res.status(201).json({ success: true, data: charge });
    } catch (error) {
        if (error.code === 'P2002') {
            return res
                .status(400)
                .json({ success: false, message: 'A charge with this key already exists.' });
        }
        console.error('Create booking charge error:', error);
        res.status(500).json({ success: false, message: 'Failed to create booking charge.' });
    }
};

/**
 * PUT /booking-charges/:id
 * Admin: update
 */
const update = async (req, res) => {
    try {
        const { id } = req.params;
        const { label, calcType, value, isActive, sortOrder } = req.body;

        const existing = await prisma.bookingCharge.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Booking charge not found.' });
        }

        const data = {};
        if (label !== undefined) {
            if (!String(label).trim()) {
                return res.status(400).json({ success: false, message: 'Label cannot be empty.' });
            }
            data.label = String(label).trim();
        }

        const nextType =
            calcType !== undefined ? String(calcType).toLowerCase() : existing.calcType;
        if (calcType !== undefined) {
            if (!CALC_TYPES.includes(nextType)) {
                return res.status(400).json({
                    success: false,
                    message: 'calcType must be "percent" or "flat".',
                });
            }
            data.calcType = nextType;
        }

        if (value !== undefined) {
            const parsed = parseValue(value, nextType);
            if (parsed.error) {
                return res.status(400).json({ success: false, message: parsed.error });
            }
            data.value = parsed.value;
        } else if (calcType !== undefined && nextType === 'percent' && existing.value > 100) {
            return res.status(400).json({
                success: false,
                message: 'Percent value cannot exceed 100. Update the value as well.',
            });
        }

        if (isActive !== undefined) data.isActive = Boolean(isActive);
        if (sortOrder !== undefined) data.sortOrder = parseInt(sortOrder, 10) || 0;

        const charge = await prisma.bookingCharge.update({ where: { id }, data });
        res.json({ success: true, data: charge });
    } catch (error) {
        console.error('Update booking charge error:', error);
        res.status(500).json({ success: false, message: 'Failed to update booking charge.' });
    }
};

/**
 * DELETE /booking-charges/:id
 * Admin: delete
 */
const remove = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await prisma.bookingCharge.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Booking charge not found.' });
        }
        await prisma.bookingCharge.delete({ where: { id } });
        res.json({ success: true, message: 'Booking charge deleted.' });
    } catch (error) {
        console.error('Delete booking charge error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete booking charge.' });
    }
};

module.exports = {
    listActive,
    listAdmin,
    create,
    update,
    remove,
};
