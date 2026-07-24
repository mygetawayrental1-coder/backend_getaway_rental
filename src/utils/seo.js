/**
 * Property SEO helpers — clean slugs + bounded meta fields.
 */

function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .trim()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

/** @returns {{ ok: true, value: string|null } | { ok: false, message: string }} */
function normalizeSeoText(value, { max, label, allowEmpty = true } = {}) {
    if (value === undefined) return { ok: true, value: undefined };
    if (value === null) return { ok: true, value: null };
    const trimmed = String(value).trim();
    if (!trimmed) {
        return allowEmpty ? { ok: true, value: null } : { ok: false, message: `${label} is required.` };
    }
    if (max && trimmed.length > max) {
        return { ok: false, message: `${label} must be at most ${max} characters.` };
    }
    return { ok: true, value: trimmed };
}

/**
 * Sanitize SEO fields from an update/create body.
 * @returns {{ data: object, error?: string }}
 */
function sanitizePropertySeoFields(body) {
    const data = {};

    if (body.slug !== undefined) {
        const slug = slugify(body.slug);
        if (!slug) {
            return { data: {}, error: 'URL slug must contain letters or numbers (e.g. miami-beach-condo).' };
        }
        data.slug = slug;
    }

    const title = normalizeSeoText(body.seoTitle, { max: 70, label: 'Meta title' });
    if (!title.ok) return { data: {}, error: title.message };
    if (title.value !== undefined) data.seoTitle = title.value;

    const description = normalizeSeoText(body.seoDescription, { max: 320, label: 'Meta description' });
    if (!description.ok) return { data: {}, error: description.message };
    if (description.value !== undefined) data.seoDescription = description.value;

    const keywords = normalizeSeoText(body.seoKeywords, { max: 300, label: 'Meta keywords' });
    if (!keywords.ok) return { data: {}, error: keywords.message };
    if (keywords.value !== undefined) data.seoKeywords = keywords.value;

    if (body.seoCanonicalUrl !== undefined) {
        const raw = body.seoCanonicalUrl == null ? '' : String(body.seoCanonicalUrl).trim();
        if (!raw) {
            data.seoCanonicalUrl = null;
        } else {
            try {
                const u = new URL(raw);
                if (u.protocol !== 'http:' && u.protocol !== 'https:') {
                    return { data: {}, error: 'Canonical URL must start with http:// or https://' };
                }
                data.seoCanonicalUrl = u.toString();
            } catch {
                return { data: {}, error: 'Canonical URL is not a valid URL.' };
            }
        }
    }

    if (body.seoBacklinks !== undefined) {
        const notes = body.seoBacklinks == null ? '' : String(body.seoBacklinks).trim();
        data.seoBacklinks = notes || null;
    }

    return { data };
}

async function ensureUniquePropertySlug(prisma, baseSlug, excludeId = null) {
    let slug = slugify(baseSlug) || 'stay';
    let n = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const existing = await prisma.property.findFirst({
            where: {
                slug,
                ...(excludeId ? { NOT: { id: excludeId } } : {}),
            },
            select: { id: true },
        });
        if (!existing) return slug;
        n += 1;
        slug = `${slugify(baseSlug).slice(0, 70)}-${n}`;
    }
}

module.exports = {
    slugify,
    sanitizePropertySeoFields,
    ensureUniquePropertySlug,
};
