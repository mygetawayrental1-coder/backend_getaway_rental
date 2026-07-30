const prisma = require('../config/database');

const FIELD_TYPES = ['text', 'number', 'boolean', 'select', 'textarea'];
const SECTIONS = ['contact', 'party', 'extras'];
const META_NAMES = {
    hidden: 'std_checkout_hidden',
    required: 'std_checkout_required',
    labels: 'std_checkout_labels',
};
const STANDARD_IDS = [
    'fullName',
    'email',
    'phone',
    'adults',
    'children',
    'pets',
    'message',
];

function validateFieldName(name) {
    return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(name);
}

function normalizeSection(section) {
    const raw = section != null ? String(section).trim().toLowerCase() : '';
    if (SECTIONS.includes(raw)) return raw;
    if (/^[a-z][a-z0-9_]*$/.test(raw)) return raw;
    return 'extras';
}

function parseJsonArray(raw) {
    if (!raw) return [];
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
        return [];
    }
}

function parseJsonObject(raw) {
    if (!raw) return {};
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function isMetaName(name) {
    return Object.values(META_NAMES).includes(name);
}

async function loadAllFields() {
    return prisma.checkoutField.findMany({
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
}

function buildPublicConfig(allFields) {
    const byName = Object.fromEntries(allFields.map((f) => [f.name, f]));
    const hiddenStandards = parseJsonArray(byName[META_NAMES.hidden]?.options);
    const requiredStandards = parseJsonArray(byName[META_NAMES.required]?.options);
    const standardLabels = parseJsonObject(byName[META_NAMES.labels]?.options);

    const fields = allFields.filter((f) => f.isActive && !isMetaName(f.name));

    return {
        fields,
        hiddenStandards,
        requiredStandards,
        standardLabels,
        standardIds: STANDARD_IDS,
        metaNames: META_NAMES,
    };
}

/**
 * GET /checkout-fields
 * Public config for guest checkout modal
 */
const listPublic = async (req, res) => {
    try {
        const all = await loadAllFields();
        res.json({ success: true, data: buildPublicConfig(all) });
    } catch (error) {
        console.error('List checkout fields error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch checkout fields.' });
    }
};

/**
 * GET /checkout-fields/admin
 */
const listAdmin = async (req, res) => {
    try {
        const all = await loadAllFields();
        res.json({
            success: true,
            data: all,
            config: buildPublicConfig(all),
        });
    } catch (error) {
        console.error('Admin list checkout fields error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch checkout fields.' });
    }
};

/**
 * POST /checkout-fields
 */
const create = async (req, res) => {
    try {
        const { name, label, type, options, required, placeholder, section, isActive, sortOrder } =
            req.body;

        if (!name || !label || !type) {
            return res.status(400).json({
                success: false,
                message: 'Name, label, and type are required.',
            });
        }

        const machineName = String(name).trim();
        if (!validateFieldName(machineName)) {
            return res.status(400).json({
                success: false,
                message:
                    'Field name must start with a letter and contain only letters, numbers, and underscores.',
            });
        }

        if (isMetaName(machineName) && type !== 'select') {
            // allow meta upsert via create with type select
        } else if (!isMetaName(machineName) && !FIELD_TYPES.includes(type)) {
            return res.status(400).json({
                success: false,
                message: `Field type must be one of: ${FIELD_TYPES.join(', ')}.`,
            });
        }

        let optionsStr = null;
        if (options != null) {
            optionsStr = typeof options === 'string' ? options : JSON.stringify(options);
        }

        const field = await prisma.checkoutField.create({
            data: {
                name: machineName,
                label: String(label).trim(),
                type: String(type),
                options: optionsStr,
                required: !!required,
                placeholder: placeholder ? String(placeholder) : null,
                section: normalizeSection(section),
                isActive: isMetaName(machineName) ? false : isActive !== false,
                sortOrder: sortOrder != null ? parseInt(sortOrder, 10) || 0 : 0,
            },
        });

        res.status(201).json({ success: true, data: field });
    } catch (error) {
        if (error.code === 'P2002') {
            return res
                .status(400)
                .json({ success: false, message: 'A field with this name already exists.' });
        }
        console.error('Create checkout field error:', error);
        res.status(500).json({ success: false, message: 'Failed to create checkout field.' });
    }
};

/**
 * PUT /checkout-fields/:id
 */
const update = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await prisma.checkoutField.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Field not found.' });
        }

        const { label, type, options, required, placeholder, section, isActive, sortOrder } =
            req.body;

        const data = {};
        if (label != null) data.label = String(label).trim();
        if (type != null) {
            if (!isMetaName(existing.name) && !FIELD_TYPES.includes(type)) {
                return res.status(400).json({
                    success: false,
                    message: `Field type must be one of: ${FIELD_TYPES.join(', ')}.`,
                });
            }
            data.type = String(type);
        }
        if (options !== undefined) {
            data.options =
                options == null
                    ? null
                    : typeof options === 'string'
                      ? options
                      : JSON.stringify(options);
        }
        if (required != null) data.required = !!required;
        if (placeholder !== undefined) {
            data.placeholder = placeholder ? String(placeholder) : null;
        }
        if (section != null) data.section = normalizeSection(section);
        if (isActive != null && !isMetaName(existing.name)) data.isActive = !!isActive;
        if (sortOrder != null) data.sortOrder = parseInt(sortOrder, 10) || 0;

        const field = await prisma.checkoutField.update({ where: { id }, data });
        res.json({ success: true, data: field });
    } catch (error) {
        console.error('Update checkout field error:', error);
        res.status(500).json({ success: false, message: 'Failed to update checkout field.' });
    }
};

/**
 * DELETE /checkout-fields/:id
 */
const remove = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await prisma.checkoutField.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Field not found.' });
        }
        await prisma.checkoutField.delete({ where: { id } });
        res.json({ success: true, message: 'Field deleted.' });
    } catch (error) {
        console.error('Delete checkout field error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete checkout field.' });
    }
};

/**
 * PUT /checkout-fields/meta/standards
 * Upsert hidden / required / label meta for standard checkout fields
 */
const upsertStandardsMeta = async (req, res) => {
    try {
        const { hiddenStandards, requiredStandards, standardLabels } = req.body;

        const upsertOne = async (name, label, optionsValue) => {
            const options =
                typeof optionsValue === 'string' ? optionsValue : JSON.stringify(optionsValue ?? []);
            const existing = await prisma.checkoutField.findUnique({ where: { name } });
            if (existing) {
                return prisma.checkoutField.update({
                    where: { name },
                    data: { options, isActive: false, type: 'select', label },
                });
            }
            return prisma.checkoutField.create({
                data: {
                    name,
                    label,
                    type: 'select',
                    options,
                    required: false,
                    section: 'extras',
                    isActive: false,
                    sortOrder: 9999,
                },
            });
        };

        if (hiddenStandards != null) {
            await upsertOne(META_NAMES.hidden, 'Hidden standard checkout fields', hiddenStandards);
        }
        if (requiredStandards != null) {
            await upsertOne(
                META_NAMES.required,
                'Required standard checkout fields',
                requiredStandards,
            );
        }
        if (standardLabels != null) {
            await upsertOne(META_NAMES.labels, 'Standard checkout field labels', standardLabels);
        }

        const all = await loadAllFields();
        res.json({ success: true, data: all, config: buildPublicConfig(all) });
    } catch (error) {
        console.error('Upsert checkout standards meta error:', error);
        res.status(500).json({ success: false, message: 'Failed to update checkout standards.' });
    }
};

/** Helper used by guestRequest.controller */
async function getCheckoutConfig() {
    const all = await loadAllFields();
    return buildPublicConfig(all);
}

module.exports = {
    listPublic,
    listAdmin,
    create,
    update,
    remove,
    upsertStandardsMeta,
    getCheckoutConfig,
    META_NAMES,
    STANDARD_IDS,
};
