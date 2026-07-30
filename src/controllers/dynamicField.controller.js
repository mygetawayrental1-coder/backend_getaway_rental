const prisma = require('../config/database');

const FIELD_TYPES = ['text', 'number', 'boolean', 'select', 'textarea'];
/** Must match Admin Dynamic Fields sections + website / Flutter listing form. */
const SECTIONS = [
    'basic',
    'location',
    'capacity',
    'pricing',
    'rules',
    'suitability',
    'photos',
    'amenities',
    'calendar',
    'features',
    'details',
    'links',
];


function validateFieldName(name) {
    // Alphanumeric and underscores only, must start with a letter
    return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(name);
}

/** Keep the section the admin chose — never silently remap (e.g. capacity → features/details). */
function normalizeSection(section) {
    const raw = section != null ? String(section).trim().toLowerCase() : '';
    if (!raw) return 'details';
    if (raw === 'pricing_standard') return 'pricing';
    if (raw === 'rules_standard') return 'rules';
    // Known sections always win (Capacity must stay capacity).
    if (SECTIONS.includes(raw)) return raw;
    // Accept other slugs so future sections are not forced to "details".
    if (/^[a-z][a-z0-9_]*$/.test(raw)) return raw;
    return 'details';
}

/**
 * GET /dynamic-fields
 * Public: Get all active dynamic field definitions
 */
const getDynamicFields = async (req, res) => {
    try {
        const fields = await prisma.dynamicField.findMany({
            where: { isActive: true },
            orderBy: { createdAt: 'asc' },
        });
        res.json({ success: true, data: fields });
    } catch (error) {
        console.error('Get active dynamic fields error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch dynamic fields.' });
    }
};

/**
 * GET /dynamic-fields/admin
 * Admin Only: Get all dynamic fields (active and inactive)
 */
const adminGetDynamicFields = async (req, res) => {
    try {
        const fields = await prisma.dynamicField.findMany({
            orderBy: { createdAt: 'asc' },
        });
        res.json({ success: true, data: fields });
    } catch (error) {
        console.error('Get admin dynamic fields error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch dynamic fields.' });
    }
};

/**
 * POST /dynamic-fields
 * Admin Only: Create a new dynamic field
 */
const createDynamicField = async (req, res) => {
    try {
        const { name, label, type, options, required, placeholder, section, isActive } = req.body;

        if (!name || !label || !type) {
            return res.status(400).json({ success: false, message: 'Name, label, and type are required.' });
        }

        const machineName = String(name).trim();
        if (!validateFieldName(machineName)) {
            return res.status(400).json({
                success: false,
                message: 'Field name must start with a letter and contain only letters, numbers, and underscores (e.g. pet_fee).',
            });
        }

        if (!FIELD_TYPES.includes(type)) {
            return res.status(400).json({
                success: false,
                message: `Field type must be one of: ${FIELD_TYPES.join(', ')}.`,
            });
        }

        if (section == null || String(section).trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Section is required (e.g. capacity, amenities, basic).',
            });
        }
        const activeSection = normalizeSection(section);

        // Format options if type is select
        let parsedOptions = null;
        if (type === 'select') {
            if (options) {
                if (typeof options === 'string') {
                    // Try parsing as JSON or convert comma-separated string to array
                    try {
                        const parsed = JSON.parse(options);
                        parsedOptions = Array.isArray(parsed) ? JSON.stringify(parsed) : JSON.stringify([options]);
                    } catch {
                        const parts = options.split(',').map((opt) => opt.trim()).filter(Boolean);
                        parsedOptions = JSON.stringify(parts);
                    }
                } else if (Array.isArray(options)) {
                    parsedOptions = JSON.stringify(options);
                }
            } else {
                return res.status(400).json({
                    success: false,
                    message: 'Options are required for a select field type.',
                });
            }
        }

        const field = await prisma.dynamicField.create({
            data: {
                name: machineName,
                label: String(label).trim(),
                type,
                options: parsedOptions,
                required: Boolean(required),
                placeholder: placeholder ? String(placeholder).trim() : null,
                section: activeSection,
                isActive: isActive !== false,
            },
        });

        res.status(201).json({ success: true, data: field });
    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: 'A field with this name already exists.' });
        }
        console.error('Create dynamic field error:', error);
        res.status(500).json({ success: false, message: 'Failed to create dynamic field.' });
    }
};

/**
 * PUT /dynamic-fields/:id
 * Admin Only: Update an existing dynamic field definition
 */
const updateDynamicField = async (req, res) => {
    try {
        const { id } = req.params;
        const { label, type, options, required, placeholder, section, isActive } = req.body;

        const existing = await prisma.dynamicField.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Dynamic field not found.' });
        }

        const updateData = {};
        if (label !== undefined) updateData.label = String(label).trim();
        
        if (type !== undefined) {
            if (!FIELD_TYPES.includes(type)) {
                return res.status(400).json({
                    success: false,
                    message: `Field type must be one of: ${FIELD_TYPES.join(', ')}.`,
                });
            }
            updateData.type = type;
        }

        // Format options if type is select or updating type/options
        const finalType = type || existing.type;
        if (finalType === 'select') {
            if (options !== undefined) {
                if (typeof options === 'string') {
                    try {
                        const parsed = JSON.parse(options);
                        updateData.options = Array.isArray(parsed) ? JSON.stringify(parsed) : JSON.stringify([options]);
                    } catch {
                        const parts = options.split(',').map((opt) => opt.trim()).filter(Boolean);
                        updateData.options = JSON.stringify(parts);
                    }
                } else if (Array.isArray(options)) {
                    updateData.options = JSON.stringify(options);
                }
            } else if (!existing.options) {
                return res.status(400).json({
                    success: false,
                    message: 'Options are required for a select field type.',
                });
            }
        } else {
            updateData.options = null; // Clear options for non-select fields
        }

        if (required !== undefined) updateData.required = Boolean(required);
        if (placeholder !== undefined) updateData.placeholder = placeholder ? String(placeholder).trim() : null;
        if (section !== undefined) updateData.section = normalizeSection(section);
        if (isActive !== undefined) updateData.isActive = Boolean(isActive);

        const field = await prisma.dynamicField.update({
            where: { id },
            data: updateData,
        });

        res.json({ success: true, data: field });
    } catch (error) {
        console.error('Update dynamic field error:', error);
        res.status(500).json({ success: false, message: 'Failed to update dynamic field.' });
    }
};

/**
 * DELETE /dynamic-fields/:id
 * Admin Only: Delete a dynamic field definition
 */
const deleteDynamicField = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await prisma.dynamicField.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Dynamic field not found.' });
        }

        await prisma.dynamicField.delete({ where: { id } });

        res.json({ success: true, message: 'Dynamic field definition deleted.' });
    } catch (error) {
        console.error('Delete dynamic field error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete dynamic field.' });
    }
};

module.exports = {
    getDynamicFields,
    adminGetDynamicFields,
    createDynamicField,
    updateDynamicField,
    deleteDynamicField,
};
