const prisma = require('../config/database');

/** Default contact settings — mirrors what was previously hardcoded in the UI. */
const DEFAULT_CONTACT = {
    phone: '+1 312 802 0111',
    phoneTel: '+13128020111',
    emails: ['sherrymay89@gmail.com', 'smay@kidscastleschoolage.com'],
    social: {
        facebook: '',
        twitter: '',
        youtube: '',
        instagram: '',
    },
};

/**
 * GET /api/web/site-settings/contact (public)
 * Returns the contact settings. Falls back to defaults if not yet saved.
 */
const getContact = async (req, res) => {
    try {
        const row = await prisma.siteSettings.findUnique({ where: { key: 'contact' } });
        if (!row) {
            return res.json({ success: true, data: DEFAULT_CONTACT });
        }
        const data = JSON.parse(row.value);
        return res.json({ success: true, data });
    } catch (err) {
        console.error('[SiteSettings] getContact error:', err);
        // Graceful fallback — never break the public website
        return res.json({ success: true, data: DEFAULT_CONTACT });
    }
};

/**
 * GET /site-settings (admin)
 * Returns all site-settings rows.
 */
const listAll = async (req, res) => {
    try {
        const rows = await prisma.siteSettings.findMany();
        // Parse the value JSON for each row
        const data = rows.map((r) => {
            try { return { key: r.key, value: JSON.parse(r.value), updatedAt: r.updatedAt }; }
            catch { return { key: r.key, value: r.value, updatedAt: r.updatedAt }; }
        });
        return res.json({ success: true, data });
    } catch (err) {
        console.error('[SiteSettings] listAll error:', err);
        return res.status(500).json({ success: false, message: 'Failed to load site settings.' });
    }
};

/**
 * PUT /site-settings/contact (admin)
 * Upserts the contact settings.
 * Body: { phone, phoneTel, emails, social: { facebook, twitter, youtube, instagram } }
 */
const updateContact = async (req, res) => {
    try {
        const { phone, phoneTel, emails, social } = req.body;

        // Validate
        if (phone !== undefined && typeof phone !== 'string') {
            return res.status(400).json({ success: false, message: 'phone must be a string.' });
        }
        if (emails !== undefined && !Array.isArray(emails)) {
            return res.status(400).json({ success: false, message: 'emails must be an array.' });
        }

        // Fetch existing to merge
        const existing = await prisma.siteSettings.findUnique({ where: { key: 'contact' } });
        const current = existing ? JSON.parse(existing.value) : DEFAULT_CONTACT;

        const next = {
            phone: phone !== undefined ? String(phone).trim() : current.phone,
            phoneTel: phoneTel !== undefined ? String(phoneTel).trim() : (current.phoneTel || String(phone || current.phone).replace(/\D/g, '')),
            emails: emails !== undefined
                ? emails.map((e) => String(e).trim()).filter(Boolean)
                : current.emails,
            social: social !== undefined
                ? {
                    facebook: String(social.facebook || '').trim(),
                    twitter: String(social.twitter || '').trim(),
                    youtube: String(social.youtube || '').trim(),
                    instagram: String(social.instagram || '').trim(),
                }
                : current.social,
        };

        await prisma.siteSettings.upsert({
            where: { key: 'contact' },
            update: { value: JSON.stringify(next) },
            create: { key: 'contact', value: JSON.stringify(next) },
        });

        return res.json({ success: true, data: next, message: 'Contact settings saved.' });
    } catch (err) {
        console.error('[SiteSettings] updateContact error:', err);
        return res.status(500).json({ success: false, message: 'Failed to save contact settings.' });
    }
};

/**
 * GET /api/web/site-settings/destination-order (public)
 * Returns map of { [locationSlugOrNameLower]: [propertyId1, propertyId2, ...] }
 */
const getDestinationOrder = async (req, res) => {
    try {
        const row = await prisma.siteSettings.findUnique({ where: { key: 'destination_order' } });
        if (!row) {
            return res.json({ success: true, data: {} });
        }
        const data = JSON.parse(row.value);
        return res.json({ success: true, data });
    } catch (err) {
        console.error('[SiteSettings] getDestinationOrder error:', err);
        return res.json({ success: true, data: {} });
    }
};

/**
 * PUT /site-settings/destination-order (admin)
 * Upserts destination property rankings.
 */
const updateDestinationOrder = async (req, res) => {
    try {
        const { locationKey, propertyIds, rankings } = req.body;

        const existing = await prisma.siteSettings.findUnique({ where: { key: 'destination_order' } });
        let current = existing ? JSON.parse(existing.value) : {};
        if (typeof current !== 'object' || current === null) current = {};

        if (rankings && typeof rankings === 'object') {
            current = { ...current, ...rankings };
        } else if (locationKey && Array.isArray(propertyIds)) {
            const key = String(locationKey).trim().toLowerCase();
            current[key] = propertyIds.map(String);
        }

        await prisma.siteSettings.upsert({
            where: { key: 'destination_order' },
            update: { value: JSON.stringify(current) },
            create: { key: 'destination_order', value: JSON.stringify(current) },
        });

/**
 * GET /api/web/site-settings/category-order (public)
 * Returns map of { [rentalTypeLower]: [propertyId1, propertyId2, ...] }
 */
const getCategoryOrder = async (req, res) => {
    try {
        const row = await prisma.siteSettings.findUnique({ where: { key: 'category_order' } });
        if (!row) {
            return res.json({ success: true, data: {} });
        }
        const data = JSON.parse(row.value);
        return res.json({ success: true, data });
    } catch (err) {
        console.error('[SiteSettings] getCategoryOrder error:', err);
        return res.json({ success: true, data: {} });
    }
};

/**
 * PUT /site-settings/category-order (admin)
 * Upserts rental type category property rankings.
 */
const updateCategoryOrder = async (req, res) => {
    try {
        const { categoryKey, propertyIds, rankings } = req.body;

        const existing = await prisma.siteSettings.findUnique({ where: { key: 'category_order' } });
        let current = existing ? JSON.parse(existing.value) : {};
        if (typeof current !== 'object' || current === null) current = {};

        if (rankings && typeof rankings === 'object') {
            current = { ...current, ...rankings };
        } else if (categoryKey && Array.isArray(propertyIds)) {
            const key = String(categoryKey).trim().toLowerCase();
            current[key] = propertyIds.map(String);
        }

        await prisma.siteSettings.upsert({
            where: { key: 'category_order' },
            update: { value: JSON.stringify(current) },
            create: { key: 'category_order', value: JSON.stringify(current) },
        });

        const { triggerWebsiteRevalidation } = require('../utils/revalidate');
        triggerWebsiteRevalidation({ tags: ['homepage', 'featured-properties', 'locations'], paths: ['/', '/search-rental-full-map'] });

        return res.json({ success: true, data: current, message: 'Category property order saved.' });
    } catch (err) {
        console.error('[SiteSettings] updateCategoryOrder error:', err);
        return res.status(500).json({ success: false, message: 'Failed to save category order.' });
    }
};

module.exports = {
    getContact,
    listAll,
    updateContact,
    getDestinationOrder,
    updateDestinationOrder,
    getCategoryOrder,
    updateCategoryOrder,
};



